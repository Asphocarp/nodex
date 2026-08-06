import type { BlockRecordApplyInput } from "../core-modules/block-record-module";
import type { BlockPlacementParent } from "./contracts";
import type { BlockNoteBlockValue } from "../block-documents/nfm-blocknote-adapter";
import { blockKindToCore } from "./kind";

export interface BlockRecordApplyIdentity {
  readonly operationId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly committedAt?: string;
}

export interface BatchBlockRecordApplyInput extends BlockRecordApplyIdentity {
  /** Wire operations must already be validated by their typed builders. */
  readonly operations: readonly Exclude<
    BlockRecordApplyInput["operation"],
    { readonly kind: "batch" }
  >[];
}

export interface PromoteBlockRecordApplyInput extends BlockRecordApplyIdentity {
  readonly blockId: string;
  readonly dataSourceId: string;
  readonly viewId?: string | null;
  readonly viewGroupKey?: string | null;
  readonly viewRankKey?: string | null;
  readonly rankKey: string;
  readonly expectedBlockRevision: number;
  readonly expectedPlacementRevision: number;
}

export interface CreateBlockRecordApplyInput extends BlockRecordApplyIdentity {
  readonly blockId: string;
  readonly blockKind: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly contentShardId: string;
  readonly parent: BlockPlacementParent;
  readonly rankKey: string;
  readonly viewId?: string | null;
  readonly dataSourceId?: string | null;
  readonly viewGroupKey?: string | null;
  readonly viewRankKey?: string | null;
  readonly materializedJson?: unknown;
  readonly placementRebalances?: readonly {
    readonly blockId: string;
    readonly rankKey: string;
    readonly expectedRevision: number;
  }[];
  readonly viewRebalances?: readonly {
    readonly blockId: string;
    readonly groupKey?: string | null;
    readonly rankKey: string;
    readonly expectedRevision: number;
  }[];
}

export interface MoveBlockRecordApplyInput extends BlockRecordApplyIdentity {
  readonly blockId: string;
  readonly targetParent: BlockPlacementParent;
  readonly rankKey: string;
  readonly expectedBlockRevision: number;
  readonly expectedPlacementRevision: number;
}

export interface MoveManyBlockRecordApplyInput extends BlockRecordApplyIdentity {
  readonly entries: readonly {
    readonly blockId: string;
    readonly targetParent: BlockPlacementParent;
    readonly rankKey: string;
    readonly expectedBlockRevision: number;
    readonly expectedPlacementRevision: number;
  }[];
  readonly placementRebalances?: readonly {
    readonly blockId: string;
    readonly rankKey: string;
    readonly expectedRevision: number;
  }[];
}

export interface CopySubtreeBlockRecordApplyInput extends BlockRecordApplyIdentity {
  readonly sourceBlockId: string;
  readonly targetBlockId: string;
  readonly targetParent: BlockPlacementParent;
  readonly rankKey: string;
  readonly expectedBlockRevision: number;
  readonly expectedPlacementRevision: number;
  readonly entries: readonly {
    readonly sourceBlockId: string;
    readonly targetBlockId: string;
    readonly expectedBlockRevision: number;
    readonly expectedPlacementRevision: number;
  }[];
  readonly viewId?: string | null;
  readonly dataSourceId?: string | null;
  readonly viewGroupKey?: string | null;
  readonly viewRankKey?: string | null;
  readonly placementRebalances?: readonly {
    readonly blockId: string;
    readonly rankKey: string;
    readonly expectedRevision: number;
  }[];
  readonly viewRebalances?: readonly {
    readonly blockId: string;
    readonly groupKey?: string | null;
    readonly rankKey: string;
    readonly expectedRevision: number;
  }[];
}

export interface UpdateBlockRecordApplyInput extends BlockRecordApplyIdentity {
  readonly blockId: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly expectedBlockRevision: number;
  readonly viewId?: string | null;
  readonly dataSourceId?: string | null;
  readonly viewGroupKey?: string | null;
  readonly viewRankKey?: string | null;
  readonly expectedViewRevision?: number | null;
}

export interface UpdateManyBlockRecordsApplyInput extends BlockRecordApplyIdentity {
  readonly entries: readonly {
    readonly blockId: string;
    readonly properties: Readonly<Record<string, unknown>>;
    readonly expectedBlockRevision: number;
    readonly viewId?: string | null;
    readonly dataSourceId?: string | null;
    readonly viewGroupKey?: string | null;
    readonly viewRankKey?: string | null;
    readonly expectedViewRevision?: number | null;
  }[];
  readonly viewRebalances?: readonly {
    readonly blockId: string;
    readonly groupKey?: string | null;
    readonly rankKey: string;
    readonly expectedRevision: number;
  }[];
}

export interface ArchiveBlockRecordSubtreeApplyInput extends BlockRecordApplyIdentity {
  readonly blockId: string;
  readonly expectedBlockRevision: number;
  readonly expectedPlacementRevision: number;
}

export interface RestoreBlockRecordSubtreeApplyInput extends BlockRecordApplyIdentity {
  readonly blockId: string;
  readonly targetParent: BlockPlacementParent;
  readonly rankKey: string;
  readonly expectedBlockRevision: number;
  readonly expectedPlacementRevision: number;
  readonly placementRebalances?: readonly {
    readonly blockId: string;
    readonly rankKey: string;
    readonly expectedRevision: number;
  }[];
}

export interface PromoteManyBlockRecordApplyInput extends BlockRecordApplyIdentity {
  readonly dataSourceId: string;
  readonly viewId?: string | null;
  readonly entries: readonly {
    readonly blockId: string;
    readonly viewGroupKey?: string | null;
    readonly viewRankKey?: string | null;
    readonly rankKey: string;
    readonly expectedBlockRevision: number;
    readonly expectedPlacementRevision: number;
  }[];
  readonly viewRebalances?: readonly {
    readonly blockId: string;
    readonly groupKey?: string | null;
    readonly rankKey: string;
    readonly expectedRevision: number;
  }[];
  readonly placementRebalances?: readonly {
    readonly blockId: string;
    readonly rankKey: string;
    readonly expectedRevision: number;
  }[];
}

export interface PlaceManyPagesInDataSourceApplyInput extends BlockRecordApplyIdentity {
  readonly dataSourceId: string;
  readonly viewId?: string | null;
  readonly entries: readonly {
    readonly blockId: string;
    readonly viewGroupKey?: string | null;
    readonly viewRankKey?: string | null;
    readonly rankKey: string;
    readonly expectedBlockRevision: number;
    readonly expectedPlacementRevision: number;
  }[];
  readonly viewRebalances?: readonly {
    readonly blockId: string;
    readonly groupKey?: string | null;
    readonly rankKey: string;
    readonly expectedRevision: number;
  }[];
  readonly placementRebalances?: readonly {
    readonly blockId: string;
    readonly rankKey: string;
    readonly expectedRevision: number;
  }[];
}

export interface SetDataSourceValuesBlockRecordApplyInput extends BlockRecordApplyIdentity {
  readonly blockId: string;
  readonly dataSourceId: string;
  readonly values: readonly {
    readonly propertyId: string;
    readonly value: unknown;
    readonly revision?: number;
  }[];
  readonly expectedBlockRevision: number;
}

export interface SetMaterializedContentBlockRecordApplyInput extends BlockRecordApplyIdentity {
  readonly blockId: string;
  readonly slot: "title" | "inline" | "body" | "properties";
  readonly materializedJson: unknown;
  readonly expectedRevision: number;
}

export interface ReconcilePageTreeBlockRecordApplyInput extends BlockRecordApplyIdentity {
  readonly pageId: string;
  readonly expectedPageRevision: number;
  readonly nodes: readonly {
    readonly block: BlockNoteBlockValue;
    readonly parentBlockId?: string | null;
    readonly rankKey: string;
    readonly contentShardId: string;
    readonly expectedBlockRevision?: number;
    readonly expectedPlacementRevision?: number;
    readonly expectedContentRevision?: number;
  }[];
}

const assertIdentity = (label: string, value: string): void => {
  if (!value.trim() || value.trim() !== value) throw new Error(`${label} is invalid`);
};

const assertRevision = (label: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`);
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
};

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const parentToWire = (parent: BlockPlacementParent) => {
  if (parent.kind === "library") return { kind: "library" as const };
  if (parent.kind === "block") return { kind: "block" as const, id: parent.blockId };
  return { kind: "data_source" as const, id: parent.dataSourceId };
};

export const buildCreateBlockRecordApplyInput = async (
  input: CreateBlockRecordApplyInput,
): Promise<BlockRecordApplyInput> => {
  for (const [label, value] of [
    ["blockId", input.blockId],
    ["blockKind", input.blockKind],
    ["contentShardId", input.contentShardId],
    ["rankKey", input.rankKey],
  ] as const) assertIdentity(label, value);
  if (input.viewId !== null && input.viewId !== undefined) assertIdentity("viewId", input.viewId);
  if (input.dataSourceId !== null && input.dataSourceId !== undefined) assertIdentity("dataSourceId", input.dataSourceId);
  if (input.viewGroupKey !== null && input.viewGroupKey !== undefined) assertIdentity("viewGroupKey", input.viewGroupKey);
  if (input.viewRankKey !== null && input.viewRankKey !== undefined) assertIdentity("viewRankKey", input.viewRankKey);
  const hasView = input.viewId !== null && input.viewId !== undefined;
  if (!hasView && (
    input.dataSourceId !== null && input.dataSourceId !== undefined
    || input.viewGroupKey !== null && input.viewGroupKey !== undefined
    || input.viewRankKey !== null && input.viewRankKey !== undefined
  )) {
    throw new Error("Create View fields require a viewId");
  }
  if (hasView && (
    input.dataSourceId === null || input.dataSourceId === undefined
    || input.viewRankKey === null || input.viewRankKey === undefined
  )) {
    throw new Error("Create View requires dataSourceId and viewRankKey");
  }
  const placementRebalanceIds = new Set<string>();
  const placementRebalances = (input.placementRebalances ?? []).map((rebalance) => {
    assertIdentity("blockId", rebalance.blockId);
    assertIdentity("rankKey", rebalance.rankKey);
    if (rebalance.blockId === input.blockId) {
      throw new Error("placementRebalances cannot include the created blockId");
    }
    if (!placementRebalanceIds.add(rebalance.blockId)) {
      throw new Error("placementRebalances contain a duplicate blockId");
    }
    assertRevision("expectedRevision", rebalance.expectedRevision);
    return {
      block_id: rebalance.blockId,
      rank_key: rebalance.rankKey,
      expected_revision: rebalance.expectedRevision,
    };
  });
  const viewRebalanceIds = new Set<string>();
  const viewRebalances = (input.viewRebalances ?? []).map((rebalance) => {
    assertIdentity("blockId", rebalance.blockId);
    assertIdentity("rankKey", rebalance.rankKey);
    if (rebalance.blockId === input.blockId) {
      throw new Error("viewRebalances cannot include the created blockId");
    }
    if (!viewRebalanceIds.add(rebalance.blockId)) {
      throw new Error("viewRebalances contain a duplicate blockId");
    }
    if (rebalance.groupKey !== null && rebalance.groupKey !== undefined) {
      assertIdentity("groupKey", rebalance.groupKey);
    }
    assertRevision("expectedRevision", rebalance.expectedRevision);
    return {
      block_id: rebalance.blockId,
      group_key: rebalance.groupKey ?? null,
      rank_key: rebalance.rankKey,
      expected_revision: rebalance.expectedRevision,
    };
  });
  if (viewRebalances.length > 0 && !hasView) {
    throw new Error("Create View rebalances require a viewId");
  }
  const operation = {
    kind: "create" as const,
    block_id: input.blockId,
    block_kind: input.blockKind,
    properties: input.properties,
    content_shard_id: input.contentShardId,
    parent: parentToWire(input.parent),
    rank_key: input.rankKey,
    view_id: input.viewId ?? null,
    data_source_id: input.dataSourceId ?? null,
    view_group_key: input.viewGroupKey ?? null,
    view_rank_key: input.viewRankKey ?? null,
    ...(input.materializedJson === undefined
      ? {}
      : { materialized_json: input.materializedJson }),
    placement_rebalances: placementRebalances,
    view_rebalances: viewRebalances,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

const identityFields = async (
  identity: BlockRecordApplyIdentity,
  operation: unknown,
): Promise<Pick<BlockRecordApplyInput, "operation_id" | "intent_hash" | "commit_id" | "canonical_hash" | "actor_id" | "session_id" | "committed_at">> => {
  for (const [label, value] of [
    ["operationId", identity.operationId],
    ["actorId", identity.actorId],
    ["sessionId", identity.sessionId],
  ] as const) assertIdentity(label, value);
  const canonicalOperation = JSON.stringify(canonicalize(operation));
  const canonicalHash = await sha256(canonicalOperation);
  return {
    operation_id: identity.operationId,
    intent_hash: canonicalHash,
    commit_id: `commit:${identity.operationId}`,
    canonical_hash: canonicalHash,
    actor_id: identity.actorId,
    session_id: identity.sessionId,
    committed_at: identity.committedAt ?? new Date().toISOString(),
  };
};

export const buildBatchBlockRecordApplyInput = async (
  input: BatchBlockRecordApplyInput,
): Promise<BlockRecordApplyInput> => {
  if (input.operations.length === 0) {
    throw new Error("Block operation batch must contain at least one operation");
  }
  const operation = {
    kind: "batch" as const,
    operations: [...input.operations],
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

export const buildPromoteBlockRecordApplyInput = async (
  input: PromoteBlockRecordApplyInput,
): Promise<BlockRecordApplyInput> => {
  for (const [label, value] of [
    ["blockId", input.blockId],
    ["dataSourceId", input.dataSourceId],
    ["rankKey", input.rankKey],
  ] as const) assertIdentity(label, value);
  if (input.viewId !== null && input.viewId !== undefined) assertIdentity("viewId", input.viewId);
  if (input.viewGroupKey !== null && input.viewGroupKey !== undefined) assertIdentity("viewGroupKey", input.viewGroupKey);
  if (input.viewRankKey !== null && input.viewRankKey !== undefined) assertIdentity("viewRankKey", input.viewRankKey);
  assertRevision("expectedBlockRevision", input.expectedBlockRevision);
  assertRevision("expectedPlacementRevision", input.expectedPlacementRevision);
  const operation = {
    kind: "promote_to_page" as const,
    block_id: input.blockId,
    data_source_id: input.dataSourceId,
    view_id: input.viewId ?? null,
    view_group_key: input.viewGroupKey ?? null,
    view_rank_key: input.viewRankKey ?? null,
    rank_key: input.rankKey,
    expected_block_revision: input.expectedBlockRevision,
    expected_placement_revision: input.expectedPlacementRevision,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

export const buildMoveBlockRecordApplyInput = async (
  input: MoveBlockRecordApplyInput,
): Promise<BlockRecordApplyInput> => {
  for (const [label, value] of [
    ["blockId", input.blockId],
    ["rankKey", input.rankKey],
  ] as const) assertIdentity(label, value);
  assertRevision("expectedBlockRevision", input.expectedBlockRevision);
  assertRevision("expectedPlacementRevision", input.expectedPlacementRevision);
  const operation = {
    kind: "move" as const,
    block_id: input.blockId,
    target_parent: parentToWire(input.targetParent),
    rank_key: input.rankKey,
    expected_block_revision: input.expectedBlockRevision,
    expected_placement_revision: input.expectedPlacementRevision,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

export const buildMoveManyBlockRecordApplyInput = async (
  input: MoveManyBlockRecordApplyInput,
): Promise<BlockRecordApplyInput> => {
  if (input.entries.length === 0) throw new Error("entries must not be empty");
  const seen = new Set<string>();
  const entries = input.entries.map((entry) => {
    assertIdentity("blockId", entry.blockId);
    assertIdentity("rankKey", entry.rankKey);
    if (seen.has(entry.blockId)) throw new Error("entries contain a duplicate blockId");
    seen.add(entry.blockId);
    assertRevision("expectedBlockRevision", entry.expectedBlockRevision);
    assertRevision("expectedPlacementRevision", entry.expectedPlacementRevision);
    return {
      block_id: entry.blockId,
      target_parent: parentToWire(entry.targetParent),
      rank_key: entry.rankKey,
      expected_block_revision: entry.expectedBlockRevision,
      expected_placement_revision: entry.expectedPlacementRevision,
    };
  });
  const placementRebalances = (input.placementRebalances ?? []).map((rebalance) => {
    assertIdentity("blockId", rebalance.blockId);
    assertIdentity("rankKey", rebalance.rankKey);
    if (seen.has(rebalance.blockId)) {
      throw new Error("placementRebalances repeat an entry blockId");
    }
    seen.add(rebalance.blockId);
    assertRevision("expectedRevision", rebalance.expectedRevision);
    return {
      block_id: rebalance.blockId,
      rank_key: rebalance.rankKey,
      expected_revision: rebalance.expectedRevision,
    };
  });
  const operation = {
    kind: "move_many" as const,
    entries,
    placement_rebalances: placementRebalances,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

export const buildCopySubtreeBlockRecordApplyInput = async (
  input: CopySubtreeBlockRecordApplyInput,
): Promise<BlockRecordApplyInput> => {
  for (const [label, value] of [
    ["sourceBlockId", input.sourceBlockId],
    ["targetBlockId", input.targetBlockId],
    ["rankKey", input.rankKey],
  ] as const) assertIdentity(label, value);
  if (input.sourceBlockId === input.targetBlockId) {
    throw new Error("Copy source and target identities must differ");
  }
  assertRevision("expectedBlockRevision", input.expectedBlockRevision);
  assertRevision("expectedPlacementRevision", input.expectedPlacementRevision);
  if (input.entries.some((entry) => entry.sourceBlockId === input.sourceBlockId)) {
    throw new Error("Copy entries must not repeat the source root");
  }
  const sourceIds = new Set([input.sourceBlockId]);
  const targetIds = new Set([input.targetBlockId]);
  const entries = input.entries.map((entry) => {
    assertIdentity("sourceBlockId", entry.sourceBlockId);
    assertIdentity("targetBlockId", entry.targetBlockId);
    if (sourceIds.has(entry.sourceBlockId) || targetIds.has(entry.targetBlockId)) {
      throw new Error("Copy entries contain duplicate source or target identities");
    }
    if (entry.sourceBlockId === entry.targetBlockId) {
      throw new Error("Copy entries must remap identities");
    }
    sourceIds.add(entry.sourceBlockId);
    targetIds.add(entry.targetBlockId);
    assertRevision("expectedBlockRevision", entry.expectedBlockRevision);
    assertRevision("expectedPlacementRevision", entry.expectedPlacementRevision);
    return {
      source_block_id: entry.sourceBlockId,
      target_block_id: entry.targetBlockId,
      expected_block_revision: entry.expectedBlockRevision,
      expected_placement_revision: entry.expectedPlacementRevision,
    };
  });
  if (input.viewId !== null && input.viewId !== undefined) assertIdentity("viewId", input.viewId);
  if (input.dataSourceId !== null && input.dataSourceId !== undefined) assertIdentity("dataSourceId", input.dataSourceId);
  if (input.viewGroupKey !== null && input.viewGroupKey !== undefined) assertIdentity("viewGroupKey", input.viewGroupKey);
  if (input.viewRankKey !== null && input.viewRankKey !== undefined) assertIdentity("viewRankKey", input.viewRankKey);
  const hasView = input.viewId !== null && input.viewId !== undefined;
  if (!hasView && (
    input.dataSourceId !== null && input.dataSourceId !== undefined
    || input.viewGroupKey !== null && input.viewGroupKey !== undefined
    || input.viewRankKey !== null && input.viewRankKey !== undefined
    || (input.viewRebalances?.length ?? 0) > 0
  )) {
    throw new Error("Copy View fields require a viewId");
  }
  if (hasView && (
    input.dataSourceId === null || input.dataSourceId === undefined
    || input.viewRankKey === null || input.viewRankKey === undefined
  )) {
    throw new Error("Copy View requires dataSourceId and viewRankKey");
  }
  const placementRebalanceIds = new Set<string>();
  const placementRebalances = (input.placementRebalances ?? []).map((rebalance) => {
    assertIdentity("blockId", rebalance.blockId);
    assertIdentity("rankKey", rebalance.rankKey);
    if (
      targetIds.has(rebalance.blockId)
      || sourceIds.has(rebalance.blockId)
      || !placementRebalanceIds.add(rebalance.blockId)
    ) {
      throw new Error("Copy placement rebalance repeats a copied identity");
    }
    assertRevision("expectedRevision", rebalance.expectedRevision);
    return {
      block_id: rebalance.blockId,
      rank_key: rebalance.rankKey,
      expected_revision: rebalance.expectedRevision,
    };
  });
  const viewRebalanceIds = new Set<string>();
  const viewRebalances = (input.viewRebalances ?? []).map((rebalance) => {
    assertIdentity("blockId", rebalance.blockId);
    assertIdentity("rankKey", rebalance.rankKey);
    if (
      rebalance.blockId === input.targetBlockId
      || sourceIds.has(rebalance.blockId)
      || !viewRebalanceIds.add(rebalance.blockId)
    ) {
      throw new Error("Copy View rebalance repeats a copied identity");
    }
    if (rebalance.groupKey !== null && rebalance.groupKey !== undefined) assertIdentity("groupKey", rebalance.groupKey);
    assertRevision("expectedRevision", rebalance.expectedRevision);
    return {
      block_id: rebalance.blockId,
      group_key: rebalance.groupKey ?? null,
      rank_key: rebalance.rankKey,
      expected_revision: rebalance.expectedRevision,
    };
  });
  const operation = {
    kind: "copy_subtree" as const,
    source_block_id: input.sourceBlockId,
    target_block_id: input.targetBlockId,
    target_parent: parentToWire(input.targetParent),
    rank_key: input.rankKey,
    expected_block_revision: input.expectedBlockRevision,
    expected_placement_revision: input.expectedPlacementRevision,
    entries,
    view_id: input.viewId ?? null,
    data_source_id: input.dataSourceId ?? null,
    view_group_key: input.viewGroupKey ?? null,
    view_rank_key: input.viewRankKey ?? null,
    placement_rebalances: placementRebalances,
    view_rebalances: viewRebalances,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

export const buildUpdateBlockRecordApplyInput = async (
  input: UpdateBlockRecordApplyInput,
): Promise<BlockRecordApplyInput> => {
  assertIdentity("blockId", input.blockId);
  assertRevision("expectedBlockRevision", input.expectedBlockRevision);
  if (input.viewId !== null && input.viewId !== undefined) assertIdentity("viewId", input.viewId);
  if (input.dataSourceId !== null && input.dataSourceId !== undefined) assertIdentity("dataSourceId", input.dataSourceId);
  if (input.viewGroupKey !== null && input.viewGroupKey !== undefined) assertIdentity("viewGroupKey", input.viewGroupKey);
  if (input.viewRankKey !== null && input.viewRankKey !== undefined) assertIdentity("viewRankKey", input.viewRankKey);
  if (input.expectedViewRevision !== null && input.expectedViewRevision !== undefined) {
    assertRevision("expectedViewRevision", input.expectedViewRevision);
  }
  const hasView = input.viewId !== null && input.viewId !== undefined;
  if (!hasView && (
    input.dataSourceId !== null && input.dataSourceId !== undefined
    || input.viewGroupKey !== null && input.viewGroupKey !== undefined
    || input.viewRankKey !== null && input.viewRankKey !== undefined
    || input.expectedViewRevision !== null && input.expectedViewRevision !== undefined
  )) {
    throw new Error("View update fields require a viewId");
  }
  if (hasView && (
    input.dataSourceId === null || input.dataSourceId === undefined
    || input.viewRankKey === null || input.viewRankKey === undefined
  )) {
    throw new Error("View update requires dataSourceId and viewRankKey");
  }
  const operation = {
    kind: "update_record" as const,
    block_id: input.blockId,
    properties: input.properties,
    expected_block_revision: input.expectedBlockRevision,
    view_id: input.viewId ?? null,
    data_source_id: input.dataSourceId ?? null,
    view_group_key: input.viewGroupKey ?? null,
    view_rank_key: input.viewRankKey ?? null,
    expected_view_revision: input.expectedViewRevision ?? null,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

export const buildUpdateManyBlockRecordsApplyInput = async (
  input: UpdateManyBlockRecordsApplyInput,
): Promise<BlockRecordApplyInput> => {
  if (input.entries.length === 0) throw new Error("entries must not be empty");
  const seen = new Set<string>();
  const entries = input.entries.map((entry) => {
    assertIdentity("blockId", entry.blockId);
    if (seen.has(entry.blockId)) throw new Error("entries contain a duplicate blockId");
    seen.add(entry.blockId);
    assertRevision("expectedBlockRevision", entry.expectedBlockRevision);
    if (entry.viewId !== null && entry.viewId !== undefined) assertIdentity("viewId", entry.viewId);
    if (entry.dataSourceId !== null && entry.dataSourceId !== undefined) assertIdentity("dataSourceId", entry.dataSourceId);
    if (entry.viewGroupKey !== null && entry.viewGroupKey !== undefined) assertIdentity("viewGroupKey", entry.viewGroupKey);
    if (entry.viewRankKey !== null && entry.viewRankKey !== undefined) assertIdentity("viewRankKey", entry.viewRankKey);
    if (entry.expectedViewRevision !== null && entry.expectedViewRevision !== undefined) {
      assertRevision("expectedViewRevision", entry.expectedViewRevision);
    }
    const hasView = entry.viewId !== null && entry.viewId !== undefined;
    if (!hasView && (
      entry.dataSourceId !== null && entry.dataSourceId !== undefined
      || entry.viewGroupKey !== null && entry.viewGroupKey !== undefined
      || entry.viewRankKey !== null && entry.viewRankKey !== undefined
      || entry.expectedViewRevision !== null && entry.expectedViewRevision !== undefined
    )) {
      throw new Error("View update fields require a viewId");
    }
    if (hasView && (
      entry.dataSourceId === null || entry.dataSourceId === undefined
      || entry.viewRankKey === null || entry.viewRankKey === undefined
    )) {
      throw new Error("View update requires dataSourceId and viewRankKey");
    }
    return {
      block_id: entry.blockId,
      properties: entry.properties,
      expected_block_revision: entry.expectedBlockRevision,
      view_id: entry.viewId ?? null,
      data_source_id: entry.dataSourceId ?? null,
      view_group_key: entry.viewGroupKey ?? null,
      view_rank_key: entry.viewRankKey ?? null,
      expected_view_revision: entry.expectedViewRevision ?? null,
    };
  });
  const viewRebalances = (input.viewRebalances ?? []).map((rebalance) => {
    assertIdentity("blockId", rebalance.blockId);
    if (seen.has(rebalance.blockId)) {
      throw new Error("viewRebalances repeat an entry blockId");
    }
    seen.add(rebalance.blockId);
    assertIdentity("rankKey", rebalance.rankKey);
    assertRevision("expectedRevision", rebalance.expectedRevision);
    if (rebalance.groupKey !== null && rebalance.groupKey !== undefined) {
      assertIdentity("groupKey", rebalance.groupKey);
    }
    return {
      block_id: rebalance.blockId,
      group_key: rebalance.groupKey ?? null,
      rank_key: rebalance.rankKey,
      expected_revision: rebalance.expectedRevision,
    };
  });
  const operation = {
    kind: "update_many" as const,
    entries,
    view_rebalances: viewRebalances,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

export const buildArchiveBlockRecordSubtreeApplyInput = async (
  input: ArchiveBlockRecordSubtreeApplyInput,
): Promise<BlockRecordApplyInput> => {
  assertIdentity("blockId", input.blockId);
  assertRevision("expectedBlockRevision", input.expectedBlockRevision);
  assertRevision("expectedPlacementRevision", input.expectedPlacementRevision);
  const operation = {
    kind: "archive_subtree" as const,
    block_id: input.blockId,
    expected_block_revision: input.expectedBlockRevision,
    expected_placement_revision: input.expectedPlacementRevision,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

export const buildRestoreBlockRecordSubtreeApplyInput = async (
  input: RestoreBlockRecordSubtreeApplyInput,
): Promise<BlockRecordApplyInput> => {
  for (const [label, value] of [
    ["blockId", input.blockId],
    ["rankKey", input.rankKey],
  ] as const) assertIdentity(label, value);
  assertRevision("expectedBlockRevision", input.expectedBlockRevision);
  assertRevision("expectedPlacementRevision", input.expectedPlacementRevision);
  const blockIds = new Set<string>([input.blockId]);
  const placementRebalances = (input.placementRebalances ?? []).map((rebalance) => {
    assertIdentity("blockId", rebalance.blockId);
    assertIdentity("rankKey", rebalance.rankKey);
    if (blockIds.has(rebalance.blockId)) {
      throw new Error("placementRebalances contain a duplicate or restored blockId");
    }
    blockIds.add(rebalance.blockId);
    assertRevision("expectedRevision", rebalance.expectedRevision);
    return {
      block_id: rebalance.blockId,
      rank_key: rebalance.rankKey,
      expected_revision: rebalance.expectedRevision,
    };
  });
  const operation = {
    kind: "restore_subtree" as const,
    block_id: input.blockId,
    target_parent: parentToWire(input.targetParent),
    rank_key: input.rankKey,
    expected_block_revision: input.expectedBlockRevision,
    expected_placement_revision: input.expectedPlacementRevision,
    placement_rebalances: placementRebalances,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

export const buildPromoteManyBlockRecordApplyInput = async (
  input: PromoteManyBlockRecordApplyInput,
): Promise<BlockRecordApplyInput> => {
  assertIdentity("dataSourceId", input.dataSourceId);
  if (input.viewId !== null && input.viewId !== undefined) assertIdentity("viewId", input.viewId);
  if (input.entries.length === 0) throw new Error("entries must not be empty");
  const blockIds = new Set<string>();
  const entries = input.entries.map((entry) => {
    assertIdentity("blockId", entry.blockId);
    assertIdentity("rankKey", entry.rankKey);
    if (blockIds.has(entry.blockId)) throw new Error("entries contain a duplicate blockId");
    blockIds.add(entry.blockId);
    if (entry.viewGroupKey !== null && entry.viewGroupKey !== undefined) {
      assertIdentity("viewGroupKey", entry.viewGroupKey);
    }
    if (entry.viewRankKey !== null && entry.viewRankKey !== undefined) {
      assertIdentity("viewRankKey", entry.viewRankKey);
    }
    assertRevision("expectedBlockRevision", entry.expectedBlockRevision);
    assertRevision("expectedPlacementRevision", entry.expectedPlacementRevision);
    return {
      block_id: entry.blockId,
      view_group_key: entry.viewGroupKey ?? null,
      view_rank_key: entry.viewRankKey ?? null,
      rank_key: entry.rankKey,
      expected_block_revision: entry.expectedBlockRevision,
      expected_placement_revision: entry.expectedPlacementRevision,
    };
  });
  const viewRebalances = (input.viewRebalances ?? []).map((rebalance) => {
    assertIdentity("blockId", rebalance.blockId);
    assertIdentity("rankKey", rebalance.rankKey);
    assertRevision("expectedRevision", rebalance.expectedRevision);
    if (rebalance.groupKey !== null && rebalance.groupKey !== undefined) {
      assertIdentity("groupKey", rebalance.groupKey);
    }
    return {
      block_id: rebalance.blockId,
      group_key: rebalance.groupKey ?? null,
      rank_key: rebalance.rankKey,
      expected_revision: rebalance.expectedRevision,
    };
  });
  const placementRebalances = (input.placementRebalances ?? []).map((rebalance) => {
    assertIdentity("blockId", rebalance.blockId);
    assertIdentity("rankKey", rebalance.rankKey);
    assertRevision("expectedRevision", rebalance.expectedRevision);
    return {
      block_id: rebalance.blockId,
      rank_key: rebalance.rankKey,
      expected_revision: rebalance.expectedRevision,
    };
  });
  const operation = {
    kind: "promote_many_to_page" as const,
    data_source_id: input.dataSourceId,
    view_id: input.viewId ?? null,
    entries,
    view_rebalances: viewRebalances,
    placement_rebalances: placementRebalances,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

export const buildPlaceManyPagesInDataSourceApplyInput = async (
  input: PlaceManyPagesInDataSourceApplyInput,
): Promise<BlockRecordApplyInput> => {
  assertIdentity("dataSourceId", input.dataSourceId);
  if (input.viewId !== null && input.viewId !== undefined) assertIdentity("viewId", input.viewId);
  if (input.entries.length === 0) throw new Error("entries must not be empty");
  const blockIds = new Set<string>();
  const entries = input.entries.map((entry) => {
    assertIdentity("blockId", entry.blockId);
    assertIdentity("rankKey", entry.rankKey);
    if (blockIds.has(entry.blockId)) throw new Error("entries contain a duplicate blockId");
    blockIds.add(entry.blockId);
    if (entry.viewGroupKey !== null && entry.viewGroupKey !== undefined) {
      assertIdentity("viewGroupKey", entry.viewGroupKey);
    }
    if (entry.viewRankKey !== null && entry.viewRankKey !== undefined) {
      assertIdentity("viewRankKey", entry.viewRankKey);
    }
    assertRevision("expectedBlockRevision", entry.expectedBlockRevision);
    assertRevision("expectedPlacementRevision", entry.expectedPlacementRevision);
    return {
      block_id: entry.blockId,
      view_group_key: entry.viewGroupKey ?? null,
      view_rank_key: entry.viewRankKey ?? null,
      rank_key: entry.rankKey,
      expected_block_revision: entry.expectedBlockRevision,
      expected_placement_revision: entry.expectedPlacementRevision,
    };
  });
  const viewRebalances = (input.viewRebalances ?? []).map((rebalance) => {
    assertIdentity("blockId", rebalance.blockId);
    assertIdentity("rankKey", rebalance.rankKey);
    assertRevision("expectedRevision", rebalance.expectedRevision);
    if (rebalance.groupKey !== null && rebalance.groupKey !== undefined) {
      assertIdentity("groupKey", rebalance.groupKey);
    }
    if (blockIds.has(rebalance.blockId)) {
      throw new Error("viewRebalances repeat an entry blockId");
    }
    return {
      block_id: rebalance.blockId,
      group_key: rebalance.groupKey ?? null,
      rank_key: rebalance.rankKey,
      expected_revision: rebalance.expectedRevision,
    };
  });
  const placementRebalances = (input.placementRebalances ?? []).map((rebalance) => {
    assertIdentity("blockId", rebalance.blockId);
    assertIdentity("rankKey", rebalance.rankKey);
    assertRevision("expectedRevision", rebalance.expectedRevision);
    if (blockIds.has(rebalance.blockId)) {
      throw new Error("placementRebalances repeat an entry blockId");
    }
    blockIds.add(rebalance.blockId);
    return {
      block_id: rebalance.blockId,
      rank_key: rebalance.rankKey,
      expected_revision: rebalance.expectedRevision,
    };
  });
  const operation = {
    kind: "place_many_in_data_source" as const,
    data_source_id: input.dataSourceId,
    view_id: input.viewId ?? null,
    entries,
    view_rebalances: viewRebalances,
    placement_rebalances: placementRebalances,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

export const buildSetDataSourceValuesBlockRecordApplyInput = async (
  input: SetDataSourceValuesBlockRecordApplyInput,
): Promise<BlockRecordApplyInput> => {
  for (const [label, value] of [
    ["blockId", input.blockId],
    ["dataSourceId", input.dataSourceId],
  ] as const) assertIdentity(label, value);
  assertRevision("expectedBlockRevision", input.expectedBlockRevision);
  const seen = new Set<string>();
  const values = input.values.map((value) => {
    assertIdentity("propertyId", value.propertyId);
    if (!seen.add(value.propertyId)) {
      throw new Error("values contain a duplicate propertyId");
    }
    if (value.revision !== undefined) assertRevision("revision", value.revision);
    return {
      property_id: value.propertyId,
      value: value.value,
      ...(value.revision === undefined ? {} : { revision: value.revision }),
    };
  });
  const operation = {
    kind: "set_data_source_values" as const,
    block_id: input.blockId,
    data_source_id: input.dataSourceId,
    values,
    expected_block_revision: input.expectedBlockRevision,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

export const buildSetMaterializedContentBlockRecordApplyInput = async (
  input: SetMaterializedContentBlockRecordApplyInput,
): Promise<BlockRecordApplyInput> => {
  assertIdentity("blockId", input.blockId);
  assertRevision("expectedRevision", input.expectedRevision);
  const operation = {
    kind: "set_materialized_content" as const,
    block_id: input.blockId,
    slot: input.slot,
    materialized_json: input.materializedJson,
    expected_revision: input.expectedRevision,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};

const flattenTree = (
  nodes: readonly {
    readonly block: BlockNoteBlockValue;
    readonly parentBlockId?: string | null;
    readonly rankKey: string;
    readonly contentShardId: string;
    readonly expectedBlockRevision?: number;
    readonly expectedPlacementRevision?: number;
    readonly expectedContentRevision?: number;
  }[],
): readonly ReconcilePageTreeBlockRecordApplyInput["nodes"][number][] => nodes;

export const buildReconcilePageTreeBlockRecordApplyInput = async (
  input: ReconcilePageTreeBlockRecordApplyInput,
): Promise<BlockRecordApplyInput> => {
  assertIdentity("pageId", input.pageId);
  assertRevision("expectedPageRevision", input.expectedPageRevision);
  const seen = new Set<string>();
  const nodes = flattenTree(input.nodes).map((entry) => {
    const blockId = entry.block.id;
    if (!blockId) throw new Error("Page tree Block is missing its stable ID");
    assertIdentity("blockId", blockId);
    assertIdentity("rankKey", entry.rankKey);
    assertIdentity("contentShardId", entry.contentShardId);
    if (seen.has(blockId)) throw new Error("Page tree contains a duplicate Block ID");
    seen.add(blockId);
    const hasBlockRevision = entry.expectedBlockRevision !== undefined;
    const hasPlacementRevision = entry.expectedPlacementRevision !== undefined;
    const hasContentRevision = entry.expectedContentRevision !== undefined;
    if (hasBlockRevision !== hasPlacementRevision || hasBlockRevision !== hasContentRevision) {
      throw new Error("Existing Page tree Blocks need complete revision preconditions");
    }
    if (hasBlockRevision) {
      assertRevision("expectedBlockRevision", entry.expectedBlockRevision!);
      assertRevision("expectedPlacementRevision", entry.expectedPlacementRevision!);
      assertRevision("expectedContentRevision", entry.expectedContentRevision!);
    }
    if (entry.parentBlockId !== null && entry.parentBlockId !== undefined) {
      assertIdentity("parentBlockId", entry.parentBlockId);
    }
    return {
      block_id: blockId,
      block_kind: blockKindToCore(entry.block.type),
      properties: entry.block.props ?? {},
      content_shard_id: entry.contentShardId,
      parent_block_id: entry.parentBlockId ?? null,
      rank_key: entry.rankKey,
      ...(hasBlockRevision
        ? {
          expected_block_revision: entry.expectedBlockRevision,
          expected_placement_revision: entry.expectedPlacementRevision,
          expected_content_revision: entry.expectedContentRevision,
        }
        : {}),
      materialized_json: entry.block.content ?? [],
    };
  });
  const operation = {
    kind: "reconcile_page_tree" as const,
    page_id: input.pageId,
    expected_page_revision: input.expectedPageRevision,
    nodes,
  };
  return {
    ...await identityFields(input, operation),
    operation,
  };
};
