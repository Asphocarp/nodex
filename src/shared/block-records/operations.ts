import type { BlockPlacementParent } from "./contracts";

export interface BlockOperationPrecondition {
  readonly blockRevision: number;
  readonly placementRevision: number;
  readonly observedCursor: {
    readonly storeEpoch: string;
    readonly commitSeq: number;
  };
}

export interface MoveBlockOperation {
  readonly kind: "move_block";
  readonly rootBlockId: string;
  readonly from: BlockPlacementParent;
  readonly to: BlockPlacementParent;
  readonly rankKey: string;
  readonly precondition: BlockOperationPrecondition;
}

export interface PromoteBlockToPageOperation {
  readonly kind: "promote_block_to_page";
  readonly rootBlockId: string;
  readonly from: BlockPlacementParent;
  readonly targetDataSourceId: string;
  readonly viewId: string | null;
  readonly viewRankKey: string;
  readonly precondition: BlockOperationPrecondition;
}

export type BlockOperation = MoveBlockOperation | PromoteBlockToPageOperation;

export interface BlockOperationBatch {
  readonly operationId: string;
  readonly intentHash: string;
  readonly libraryId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly operations: readonly BlockOperation[];
}

export interface MoveBlockInput {
  readonly operationId: string;
  readonly intentHash: string;
  readonly libraryId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly rootBlockId: string;
  readonly from: BlockPlacementParent;
  readonly to: BlockPlacementParent;
  readonly rankKey: string;
  readonly precondition: BlockOperationPrecondition;
}

export interface PromoteBlockToPageInput {
  readonly operationId: string;
  readonly intentHash: string;
  readonly libraryId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly rootBlockId: string;
  readonly from: BlockPlacementParent;
  readonly targetDataSourceId: string;
  readonly viewId?: string | null;
  readonly viewRankKey: string;
  readonly precondition: BlockOperationPrecondition;
}

const assertIdentity = (label: string, value: string): void => {
  if (!value.trim() || value.trim() !== value) {
    throw new Error(`${label} is invalid`);
  }
};

const assertRankKey = (rankKey: string): void => {
  if (!rankKey.trim() || rankKey.trim() !== rankKey) {
    throw new Error("rankKey is invalid");
  }
};

const assertPrecondition = (precondition: BlockOperationPrecondition): void => {
  if (!Number.isSafeInteger(precondition.blockRevision) || precondition.blockRevision < 0) {
    throw new Error("blockRevision is invalid");
  }
  if (!Number.isSafeInteger(precondition.placementRevision) || precondition.placementRevision < 0) {
    throw new Error("placementRevision is invalid");
  }
  assertIdentity("precondition.storeEpoch", precondition.observedCursor.storeEpoch);
  if (!Number.isSafeInteger(precondition.observedCursor.commitSeq) || precondition.observedCursor.commitSeq < 0) {
    throw new Error("precondition.commitSeq is invalid");
  }
};

export const buildMoveBlockOperation = (
  input: MoveBlockInput,
): BlockOperationBatch => {
  for (const [label, value] of [
    ["operationId", input.operationId],
    ["intentHash", input.intentHash],
    ["libraryId", input.libraryId],
    ["actorId", input.actorId],
    ["sessionId", input.sessionId],
    ["rootBlockId", input.rootBlockId],
  ] as const) assertIdentity(label, value);
  assertRankKey(input.rankKey);
  assertPrecondition(input.precondition);
  if (input.to.kind === "block" && input.rootBlockId === input.to.blockId) {
    throw new Error("A Block cannot be moved under itself");
  }
  return {
    operationId: input.operationId,
    intentHash: input.intentHash,
    libraryId: input.libraryId,
    actorId: input.actorId,
    sessionId: input.sessionId,
    operations: [{
      kind: "move_block",
      rootBlockId: input.rootBlockId,
      from: input.from,
      to: input.to,
      rankKey: input.rankKey,
      precondition: input.precondition,
    }],
  };
};

export const buildPromoteBlockToPageOperation = (
  input: PromoteBlockToPageInput,
): BlockOperationBatch => {
  for (const [label, value] of [
    ["operationId", input.operationId],
    ["intentHash", input.intentHash],
    ["libraryId", input.libraryId],
    ["actorId", input.actorId],
    ["sessionId", input.sessionId],
    ["rootBlockId", input.rootBlockId],
    ["targetDataSourceId", input.targetDataSourceId],
  ] as const) assertIdentity(label, value);
  assertRankKey(input.viewRankKey);
  assertPrecondition(input.precondition);
  return {
    operationId: input.operationId,
    intentHash: input.intentHash,
    libraryId: input.libraryId,
    actorId: input.actorId,
    sessionId: input.sessionId,
    operations: [{
      kind: "promote_block_to_page",
      rootBlockId: input.rootBlockId,
      from: input.from,
      targetDataSourceId: input.targetDataSourceId,
      viewId: input.viewId ?? null,
      viewRankKey: input.viewRankKey,
      precondition: input.precondition,
    }],
  };
};
