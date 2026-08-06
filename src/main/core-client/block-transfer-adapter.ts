import { createHash } from "node:crypto";
import type { components } from "@nodex/core-protocol";
import {
  BLOCK_TRANSFER_CONTRACT_VERSION,
  parseBlockTransferIntent,
  type BlockTransferCommandError,
  type BlockTransferCommandResult,
  type BlockTransferIntent,
  type BlockTransferReceipt,
  type BlockTransferTransformationEvidence,
} from "../../shared/block-transfer";
import { blockTransferFailure } from "../../shared/block-transfer-transport";
import type { BlockLocation } from "../../shared/block-documents/contracts";
import type { BlockRecordRead } from "../../shared/core-modules/block-record-module";
import {
  blockRecordSnapshotToWindow,
  buildCopySubtreeBlockRecordApplyInput,
  buildMoveManyBlockRecordApplyInput,
  buildPlaceManyPagesInDataSourceApplyInput,
  buildPromoteManyBlockRecordApplyInput,
  planFractionalRank,
  type BlockPlacementParent,
  type BlockRecordWindow,
} from "../../shared/block-records";
import { CoreModuleResponseError } from "./core-client";
import type {
  CoreClientPort,
  LibraryIntent,
  LibraryCommittedValue,
} from "./types";

export interface CoreBlockTransferAdapterInput {
  readonly client: CoreClientPort;
  readonly libraryId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly agentAuthorization?: components["schemas"]["AgentExecutionAuthorization"];
}

export interface CoreBlockTransferAdapter {
  commit(
    intent: BlockTransferIntent,
  ): Promise<BlockTransferCommandResult>;
}

type CoreTransferResult = NonNullable<LibraryCommittedValue["value"]["block_transfer"]>;
type CoreTransferIntent = Extract<LibraryIntent, { kind: "transfer_blocks" }>["intent"];

const toCoreIntent = (intent: BlockTransferIntent): CoreTransferIntent => ({
  actor: intent.actor,
  mode: intent.mode,
  root_block_ids: intent.rootBlockIds,
  source: (() => {
    switch (intent.source.kind) {
      case "library":
        return { kind: "library" as const, library_id: intent.source.libraryId };
      case "page":
        return { kind: "page" as const, page_id: intent.source.pageId };
      case "document":
        return { kind: "document" as const, document_id: intent.source.documentId };
      case "data_source":
        return { kind: "data_source" as const, data_source_id: intent.source.dataSourceId };
    }
  })(),
  target: (() => {
    switch (intent.target.kind) {
      case "library":
        return {
          kind: "library" as const,
          library_id: intent.target.libraryId,
          before_block_id: intent.target.beforeBlockId ?? null,
        };
      case "page":
        return {
          kind: "page" as const,
          page_id: intent.target.pageId,
          parent_block_id: intent.target.parentBlockId ?? null,
          before_block_id: intent.target.beforeBlockId ?? null,
        };
      case "document":
        return {
          kind: "document" as const,
          document_id: intent.target.documentId,
          parent_block_id: intent.target.parentBlockId ?? null,
          before_block_id: intent.target.beforeBlockId ?? null,
        };
      case "data_source":
        return {
          kind: "data_source" as const,
          data_source_id: intent.target.dataSourceId,
          view_id: intent.target.viewId,
          group_key: intent.target.groupKey,
          before_page_id: intent.target.beforePageId ?? null,
        };
    }
  })(),
});

const assertIntentScope = (
  input: CoreBlockTransferAdapterInput,
  intent: BlockTransferIntent,
): BlockTransferCommandError | null => {
  if (intent.projectId !== input.projectId) {
    return blockTransferFailure(
      "invalid_transfer_request",
      "Block transfer belongs to another Project",
      { operationId: intent.operationId },
    );
  }
  if (intent.storeEpoch !== input.storeEpoch) {
    return blockTransferFailure(
      "store_epoch_mismatch",
      "Block transfer belongs to another store epoch",
      { operationId: intent.operationId, reloadRequired: true },
    );
  }
  const referencedLibraryIds = [intent.source, intent.target]
    .filter((location) => location.kind === "library")
    .map((location) => location.libraryId);
  if (referencedLibraryIds.some((libraryId) => libraryId !== input.libraryId)) {
    return blockTransferFailure(
      "invalid_transfer_request",
      "Block transfer belongs to another Library",
      { operationId: intent.operationId },
    );
  }
  return null;
};

const fromCoreLocation = (
  location: CoreTransferResult["final_locations"][string],
): BlockLocation => {
  switch (location.kind) {
    case "library":
      return {
        kind: "space",
        projectId: location.project_id,
        rankKey: location.rank_key,
      };
    case "document":
      return { kind: "document", documentId: location.document_id };
    case "data_source":
      return { kind: "database", databaseBlockId: location.database_id };
  }
};

const requireRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  throw new Error(`${label} is not an object`);
};

const requireString = (
  value: unknown,
  label: string,
): string => {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${label} is not a non-empty string`);
};

const requireStringArray = (
  value: unknown,
  label: string,
): readonly string[] => {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  throw new Error(`${label} is not a string array`);
};

const fromCoreTransformation = (
  value: unknown,
): BlockTransferTransformationEvidence => {
  const evidence = requireRecord(value, "Core Block transformation evidence");
  const kind = evidence.kind;
  if (kind !== "move" && kind !== "copy" && kind !== "promote" && kind !== "wrap") {
    throw new Error("Core Block transformation kind is invalid");
  }
  const sourceToResult = requireRecord(
    evidence.sourceToResultBlockIds,
    "Core Block transformation identity map",
  );
  const sourceToResultBlockIds = Object.fromEntries(
    Object.entries(sourceToResult).map(([sourceId, resultId]) => [
      sourceId,
      requireString(resultId, `Core Block transformation identity ${sourceId}`),
    ]),
  );
  const wrapperReason = evidence.wrapperReason;
  if (
    wrapperReason != null &&
    wrapperReason !== "type_requires_wrapper" &&
    wrapperReason !== "unsupported_primary_content" &&
    wrapperReason !== "unmapped_type_state"
  ) {
    throw new Error("Core Block transformation wrapper reason is invalid");
  }
  return {
    sourceBlockId: requireString(evidence.sourceBlockId, "Core transformation source"),
    resultPageId: requireString(evidence.resultPageId, "Core transformation Page"),
    kind,
    sourceBlockType: requireString(evidence.sourceBlockType, "Core transformation type"),
    semanticTitleHash: requireString(
      evidence.semanticTitleHash,
      "Core transformation title hash",
    ),
    consumedPropertyKeys: requireStringArray(
      evidence.consumedPropertyKeys,
      "Core transformation consumed properties",
    ),
    ...(wrapperReason == null ? {} : { wrapperReason }),
    bodyRootBlockIds: requireStringArray(
      evidence.bodyRootBlockIds,
      "Core transformation body roots",
    ),
    sourceToResultBlockIds,
  };
};

const fromCoreResult = (
  intent: BlockTransferIntent,
  result: CoreTransferResult,
  duplicate: boolean,
  changeLogSeq: number,
  committedAt: string,
): BlockTransferReceipt => {
  return {
    version: BLOCK_TRANSFER_CONTRACT_VERSION,
    operationId: intent.operationId,
    projectId: intent.projectId,
    storeEpoch: intent.storeEpoch,
    mode: result.mode,
    duplicate,
    sourceRootBlockIds: result.source_root_block_ids,
    resultRootBlockIds: result.result_root_block_ids,
    copiedBlockIds: result.copied_block_ids,
    transformationEvidence: result.transformation_evidence.map(fromCoreTransformation),
    finalLocations: Object.fromEntries(
      Object.entries(result.final_locations).map(([blockId, location]) => [
        blockId,
        fromCoreLocation(location),
      ]),
    ),
    finalLocationRevisions: result.final_location_revisions,
    documentCommits: result.document_commits.map((commit) => ({
      documentId: commit.document_id,
      generation: commit.generation,
      baseHeadSeq: commit.base_head_seq,
      headSeq: commit.head_seq,
      updateId: commit.update_id,
      update: Uint8Array.from(commit.update),
      stateVector: Uint8Array.from(commit.state_vector),
    })),
    affectedDatabaseBlockIds: result.affected_database_ids,
    changeLogSeq,
    committedAt,
  };
};

const titleHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value ?? "")).digest("hex");

const copyIdentity = (operationId: string, sourceBlockId: string): string =>
  `copy:${createHash("sha256")
    .update(`${operationId}\0copy\0${sourceBlockId}`)
    .digest("hex")}`;

const readBlockRecordWindow = async (
  input: CoreBlockTransferAdapterInput,
  read: BlockRecordRead,
): Promise<BlockRecordWindow> => blockRecordSnapshotToWindow(
  await input.client.blockRecordRead(read),
  read,
);

const tryReadBlockRecordWindow = async (
  input: CoreBlockTransferAdapterInput,
  read: BlockRecordRead,
): Promise<BlockRecordWindow | null> => {
  try {
    return await readBlockRecordWindow(input, read);
  } catch (error) {
    if (error instanceof CoreModuleResponseError) return null;
    throw error;
  }
};

/**
 * Copies a canonical owning subtree without opening or cloning a Page-wide
 * Document. Core receives the complete identity map and copies the current
 * content snapshots inside the same LocalCommit as the new placements.
 */
export const commitCanonicalCopyIntent = async (
  input: CoreBlockTransferAdapterInput,
  intent: BlockTransferIntent,
  targetRootBlockIdOverride?: string,
): Promise<BlockTransferCommandResult | null> => {
  if (intent.rootBlockIds.length !== 1 || intent.target.kind === "document") return null;
  const sourceBlockId = intent.rootBlockIds[0];
  if (!sourceBlockId) return null;

  const sourceRead: BlockRecordRead = {
    kind: "window",
    block_ids: [sourceBlockId],
    include_content: true,
    include_descendants: true,
  };
  const sourceWindow = await tryReadBlockRecordWindow(input, sourceRead);
  if (!sourceWindow) return null;
  const sourceRecords = new Map(sourceWindow.records.map((record) => [record.id, record]));
  const sourcePlacements = new Map(
    sourceWindow.placements.map((placement) => [placement.blockId, placement]),
  );
  const sourceRoot = sourceRecords.get(sourceBlockId);
  if (!sourceRoot || !sourcePlacements.has(sourceBlockId)) return null;

  const sourceOrder: string[] = [];
  const visit = (blockId: string): void => {
    sourceOrder.push(blockId);
    sourceWindow.placements
      .filter((placement) => (
        placement.parent.kind === "block"
        && placement.parent.blockId === blockId
      ))
      .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId))
      .forEach((placement) => visit(placement.blockId));
  };
  visit(sourceBlockId);
  if (sourceOrder.some((blockId) => !sourceRecords.has(blockId))) return null;

  const target = intent.target;
  let targetParent: BlockPlacementParent;
  if (target.kind === "library") {
    targetParent = { kind: "library", libraryId: input.libraryId };
  } else if (target.kind === "page") {
    const pageId = target.pageId;
    if (!pageId) return null;
    targetParent = {
      kind: "block",
      blockId: target.parentBlockId ?? pageId,
    };
  } else {
    targetParent = { kind: "dataSource", dataSourceId: target.dataSourceId };
  }
  if (targetParent.kind === "block") {
    const parentWindow = await tryReadBlockRecordWindow(input, {
      kind: "window",
      block_ids: [targetParent.blockId],
      include_content: false,
    });
    if (!parentWindow) return null;
    if (!parentWindow.records.some((record) => record.id === targetParent.blockId)) return null;
  }
  const targetBlockParentId = targetParent.kind === "block"
    ? targetParent.blockId
    : null;
  let targetRead: BlockRecordRead;
  if (target.kind === "data_source") {
    targetRead = {
      kind: "window",
      parent: { kind: "data_source", id: target.dataSourceId },
      view_id: target.viewId,
      include_content: false,
    };
  } else if (targetParent.kind === "library") {
    targetRead = { kind: "window", include_content: false };
  } else {
    if (!targetBlockParentId) return null;
    targetRead = {
      kind: "window",
      parent: { kind: "block", id: targetBlockParentId },
      include_content: false,
    };
  }
  const targetWindow = await tryReadBlockRecordWindow(input, targetRead);
  if (!targetWindow) return null;

  const sameParent = (placement: BlockRecordWindow["placements"][number]): boolean => {
    if (targetParent.kind === "library") {
      return placement.parent.kind === "library";
    }
    if (targetParent.kind === "block") {
      return placement.parent.kind === "block"
        && placement.parent.blockId === targetBlockParentId;
    }
    return placement.parent.kind === "dataSource"
      && placement.parent.dataSourceId === targetParent.dataSourceId;
  };
  const targetItems = targetWindow.placements
    .filter(sameParent)
    .map((placement) => ({ id: placement.blockId, rankKey: placement.rankKey }));
  const beforeBlockId = target.kind === "data_source"
    ? target.beforePageId
    : target.beforeBlockId;
  const targetRootBlockId = targetRootBlockIdOverride
    ?? copyIdentity(intent.operationId, sourceBlockId);
  const copyTargetId = (sourceId: string): string => sourceId === sourceBlockId
    ? targetRootBlockId
    : copyIdentity(intent.operationId, sourceId);
  const placementPlan = planFractionalRank(targetItems, targetRootBlockId, beforeBlockId);
  const placementRebalances = [...placementPlan.rebalancedRankKeys].map(([blockId, rankKey]) => {
    const placement = targetWindow.placements.find((candidate) => candidate.blockId === blockId);
    if (!placement) throw new Error(`Copy placement rebalance target ${blockId} is not loaded`);
    return {
      blockId,
      rankKey,
      expectedRevision: placement.revision,
    };
  });

  let viewRankKey: string | null = null;
  let viewRebalances: {
    blockId: string;
    groupKey: string | null;
    rankKey: string;
    expectedRevision: number;
  }[] = [];
  if (target.kind === "data_source") {
    if (sourceRoot.kind !== "page") return null;
    const viewItems = targetWindow.viewPositions
      .filter((position) => (
        position.viewId === target.viewId
        && position.groupKey === target.groupKey
      ))
      .map((position) => ({ id: position.blockId, rankKey: position.rankKey }));
    const viewPlan = planFractionalRank(
      viewItems,
      targetRootBlockId,
      target.beforePageId,
    );
    viewRankKey = viewPlan.rankKey;
    viewRebalances = [...viewPlan.rebalancedRankKeys].map(([blockId, rankKey]) => {
      const position = targetWindow.viewPositions.find((candidate) => candidate.blockId === blockId);
      if (!position) throw new Error(`Copy View rebalance target ${blockId} is not loaded`);
      return {
        blockId,
        groupKey: position.groupKey,
        rankKey,
        expectedRevision: position.revision,
      };
    });
  }

  const entries = sourceOrder.slice(1).map((sourceId) => {
    const record = sourceRecords.get(sourceId);
    const placement = sourcePlacements.get(sourceId);
    if (!record || !placement) throw new Error(`Copy source ${sourceId} is incomplete`);
    return {
      sourceBlockId: sourceId,
      targetBlockId: copyTargetId(sourceId),
      expectedBlockRevision: record.revision,
      expectedPlacementRevision: placement.revision,
    };
  });
  const rootPlacement = sourcePlacements.get(sourceBlockId)!;
  const applyInput = await buildCopySubtreeBlockRecordApplyInput({
    operationId: intent.operationId,
    actorId: intent.clientSessionId ?? "block-transfer",
    sessionId: intent.clientSessionId ?? "block-transfer",
    sourceBlockId,
    targetBlockId: targetRootBlockId,
    targetParent,
    rankKey: placementPlan.rankKey,
    expectedBlockRevision: sourceRoot.revision,
    expectedPlacementRevision: rootPlacement.revision,
    entries,
    ...(target.kind === "data_source"
      ? {
          viewId: target.viewId,
          dataSourceId: target.dataSourceId,
          viewGroupKey: target.groupKey,
          viewRankKey,
          viewRebalances,
        }
      : {}),
    placementRebalances,
  });
  const committed = await input.client.blockRecordApply({
    ...applyInput,
    ...(input.agentAuthorization
      ? { agent_authorization: input.agentAuthorization }
      : {}),
  });
  const sourceToTargetBlockIds = Object.fromEntries(sourceOrder.map((sourceId) => [
    sourceId,
    copyTargetId(sourceId),
  ]));
  const titleContent = sourceWindow.content.find((content) => (
    content.blockId === sourceBlockId
    && (content.slot === "inline" || content.slot === "title")
  ));
  const location: BlockLocation = target.kind === "library"
    ? { kind: "space", projectId: intent.projectId, rankKey: placementPlan.rankKey }
    : target.kind === "page"
      ? { kind: "document", documentId: `block-record:${target.pageId}` }
      : { kind: "database", databaseBlockId: target.dataSourceId };
  return {
    ok: true,
    value: {
      version: BLOCK_TRANSFER_CONTRACT_VERSION,
      operationId: intent.operationId,
      projectId: intent.projectId,
      storeEpoch: intent.storeEpoch,
      mode: "copy",
      duplicate: committed.duplicate,
      sourceRootBlockIds: [sourceBlockId],
      resultRootBlockIds: [targetRootBlockId],
      copiedBlockIds: sourceToTargetBlockIds,
      transformationEvidence: [{
        sourceBlockId,
        resultPageId: targetRootBlockId,
        kind: "copy",
        sourceBlockType: sourceRoot.kind,
        semanticTitleHash: titleHash(titleContent?.content ?? sourceRoot.properties.title),
        consumedPropertyKeys: [],
        bodyRootBlockIds: sourceWindow.placements
          .filter((placement) => (
            placement.parent.kind === "block"
            && placement.parent.blockId === sourceBlockId
          ))
          .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId))
          .map((placement) => placement.blockId),
        sourceToResultBlockIds: sourceToTargetBlockIds,
      }],
      finalLocations: { [targetRootBlockId]: location },
      finalLocationRevisions: { [targetRootBlockId]: 0 },
      documentCommits: [],
      affectedDatabaseBlockIds: target.kind === "data_source" ? [target.dataSourceId] : [],
      changeLogSeq: committed.cursor.commit_seq,
      committedAt: committed.committed_at,
    },
  };
};

/**
 * Moves canonical roots to Library or Page ownership without involving the
 * legacy Library transfer compiler. The whole root set is planned against
 * one target snapshot and committed through one MoveMany operation, so a
 * multi-page Agent move cannot expose a partially moved batch.
 */
export const commitCanonicalMoveIntent = async (
  input: CoreBlockTransferAdapterInput,
  intent: BlockTransferIntent,
): Promise<BlockTransferCommandResult | null> => {
  const target = intent.target;
  if (target.kind !== "library" && target.kind !== "page") return null;
  const sourceWindow = await tryReadBlockRecordWindow(input, {
    kind: "window",
    block_ids: [...intent.rootBlockIds],
    include_content: true,
    include_descendants: true,
  });
  if (!sourceWindow) return null;
  const sourceRecords = new Map(sourceWindow.records.map((record) => [record.id, record]));
  const sourcePlacements = new Map(
    sourceWindow.placements.map((placement) => [placement.blockId, placement]),
  );
  if (intent.rootBlockIds.some((blockId) => (
    !sourceRecords.has(blockId) || !sourcePlacements.has(blockId)
  ))) {
    return null;
  }
  const sourceClosure = new Set(sourceWindow.records.map((record) => record.id));
  const targetParent: BlockPlacementParent = target.kind === "library"
    ? { kind: "library", libraryId: input.libraryId }
    : { kind: "block", blockId: target.pageId };
  if (targetParent.kind === "block" && sourceClosure.has(targetParent.blockId)) {
    throw new Error("A canonical Block cannot move into its own subtree");
  }

  const targetRead: BlockRecordRead = targetParent.kind === "library"
    ? { kind: "window", include_content: false }
    : {
        kind: "window",
        block_ids: [targetParent.blockId],
        parent: { kind: "block", id: targetParent.blockId },
        include_content: false,
      };
  const targetWindow = await tryReadBlockRecordWindow(input, targetRead);
  if (!targetWindow) return null;
  if (targetParent.kind === "block") {
    const targetRecord = targetWindow.records.find(
      (record) => record.id === targetParent.blockId,
    );
    if (!targetRecord || targetRecord.kind !== "page" || targetRecord.lifecycle !== "active") {
      throw new Error("Canonical transfer target Page is unavailable");
    }
  }

  const sameParent = (placement: BlockRecordWindow["placements"][number]): boolean => {
    if (targetParent.kind === "library") return placement.parent.kind === "library";
    return placement.parent.kind === "block"
      && placement.parent.blockId === targetParent.blockId;
  };
  const movedRoots = new Set(intent.rootBlockIds);
  const targetItems = targetWindow.placements
    .filter((placement) => sameParent(placement) && !movedRoots.has(placement.blockId))
    .sort((left, right) => (
      left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId)
    ))
    .map((placement) => ({ id: placement.blockId, rankKey: placement.rankKey }));
  const beforeBlockId = target.beforeBlockId;
  if (beforeBlockId && movedRoots.has(beforeBlockId)) {
    throw new Error("Canonical transfer anchor cannot be one of the moved roots");
  }
  const placementRebalances = new Map<string, {
    blockId: string;
    rankKey: string;
    expectedRevision: number;
  }>();
  const entries: {
    blockId: string;
    targetParent: BlockPlacementParent;
    rankKey: string;
    expectedBlockRevision: number;
    expectedPlacementRevision: number;
  }[] = [];
  for (const blockId of intent.rootBlockIds) {
    const record = sourceRecords.get(blockId);
    const placement = sourcePlacements.get(blockId);
    if (!record || !placement) return null;
    const rank = planFractionalRank(targetItems, blockId, beforeBlockId);
    for (const [rebalanceId, rankKey] of rank.rebalancedRankKeys) {
      const rebalancePlacement = targetWindow.placements.find(
        (candidate) => candidate.blockId === rebalanceId,
      );
      if (!rebalancePlacement) {
        throw new Error(`Canonical transfer rebalance target ${rebalanceId} is not loaded`);
      }
      placementRebalances.set(rebalanceId, {
        blockId: rebalanceId,
        rankKey,
        expectedRevision: rebalancePlacement.revision,
      });
      const item = targetItems.find((candidate) => candidate.id === rebalanceId);
      if (item) item.rankKey = rankKey;
    }
    const anchorIndex = beforeBlockId === undefined
      ? targetItems.length
      : targetItems.findIndex((item) => item.id === beforeBlockId);
    if (anchorIndex < 0) {
      throw new Error(`Canonical transfer anchor ${beforeBlockId} is not loaded`);
    }
    targetItems.splice(anchorIndex, 0, { id: blockId, rankKey: rank.rankKey });
    entries.push({
      blockId,
      targetParent,
      rankKey: rank.rankKey,
      expectedBlockRevision: record.revision,
      expectedPlacementRevision: placement.revision,
    });
  }
  const applyInput = await buildMoveManyBlockRecordApplyInput({
    operationId: intent.operationId,
    actorId: intent.clientSessionId ?? "block-transfer",
    sessionId: intent.clientSessionId ?? "block-transfer",
    entries,
    placementRebalances: [...placementRebalances.values()],
  });
  const committed = await input.client.blockRecordApply({
    ...applyInput,
    ...(input.agentAuthorization
      ? { agent_authorization: input.agentAuthorization }
      : {}),
  });
  const evidence = intent.rootBlockIds.map((blockId) => {
    const record = sourceRecords.get(blockId)!;
    const titleContent = sourceWindow.content.find((content) => (
      content.blockId === blockId
      && (content.slot === "inline" || content.slot === "title")
    ));
    return {
      sourceBlockId: blockId,
      resultPageId: blockId,
      kind: "move" as const,
      sourceBlockType: record.kind,
      semanticTitleHash: titleHash(titleContent?.content ?? record.properties.title),
      consumedPropertyKeys: [],
      bodyRootBlockIds: sourceWindow.placements
        .filter((placement) => (
          placement.parent.kind === "block" && placement.parent.blockId === blockId
        ))
        .sort((left, right) => (
          left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId)
        ))
        .map((placement) => placement.blockId),
      sourceToResultBlockIds: { [blockId]: blockId },
    };
  });
  const location: BlockLocation = target.kind === "library"
    ? { kind: "space", projectId: intent.projectId, rankKey: entries[0]?.rankKey ?? "" }
    : { kind: "document", documentId: `block-record:${target.pageId}` };
  return {
    ok: true,
    value: {
      version: BLOCK_TRANSFER_CONTRACT_VERSION,
      operationId: intent.operationId,
      projectId: intent.projectId,
      storeEpoch: intent.storeEpoch,
      mode: "move",
      duplicate: committed.duplicate,
      sourceRootBlockIds: intent.rootBlockIds,
      resultRootBlockIds: intent.rootBlockIds,
      copiedBlockIds: {},
      transformationEvidence: evidence,
      finalLocations: Object.fromEntries(
        intent.rootBlockIds.map((blockId) => [blockId, location]),
      ),
      finalLocationRevisions: Object.fromEntries(entries.map((entry) => [
        entry.blockId,
        entry.expectedPlacementRevision + 1,
      ])),
      documentCommits: [],
      affectedDatabaseBlockIds: [],
      changeLogSeq: committed.cursor.commit_seq,
      committedAt: committed.committed_at,
    },
  };
};

/**
 * The move-to-Board path is a BlockRecord transaction, not a Library
 * transfer followed by a projection refresh. The old Library transfer
 * compiler still handles copy semantics and document-only transfers; a move
 * into a Data Source is fully representable by PromoteManyToPage and must use
 * that terminal authority directly.
 */
const commitMoveIntoDataSource = async (
  input: CoreBlockTransferAdapterInput,
  intent: BlockTransferIntent,
): Promise<BlockTransferCommandResult | null> => {
  const target = intent.target;
  if (target.kind !== "data_source") {
    throw new Error("Data Source transfer target is required");
  }
  const targetRead: BlockRecordRead = {
    kind: "window",
    parent: { kind: "data_source", id: target.dataSourceId },
    view_id: target.viewId,
    include_content: true,
  };
  const sourceRead: BlockRecordRead = {
    kind: "window",
    block_ids: [...intent.rootBlockIds],
    include_content: true,
    include_descendants: true,
  };
  const sourceWindow = await readBlockRecordWindow(input, sourceRead);
  const sourceRoots = intent.rootBlockIds.map((blockId) =>
    sourceWindow.records.find((record) => record.id === blockId)
  );
  // A Page already has its final identity. It must use the placement-only
  // operation below; treating it as a promotion would either fail the graph
  // invariant or increment its intrinsic revision for no semantic change.
  // Missing records and mixed roots remain outside this terminal operation
  // until the one-big store replacement has converted every legacy root.
  const allExistingPages = sourceRoots.every((record) => record?.kind === "page");
  const allPromotableBlocks = sourceRoots.every((record) => (
    record !== undefined && record.kind !== "page"
  ));
  if (!allExistingPages && !allPromotableBlocks) {
    return null;
  }
  const targetWindow = await readBlockRecordWindow(input, targetRead);
  const sourceRecords = new Map(sourceWindow.records.map((record) => [record.id, record]));
  const sourcePlacements = new Map(sourceWindow.placements.map((placement) => [placement.blockId, placement]));
  const targetPositions = targetWindow.viewPositions
    .filter((position) => (
      position.viewId === target.viewId
      && position.groupKey === target.groupKey
      && !intent.rootBlockIds.includes(position.blockId)
    ))
    .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId));
  const targetPlacements = targetWindow.placements
    .filter((placement) => (
      placement.parent.kind === "dataSource"
      && placement.parent.dataSourceId === target.dataSourceId
      && !intent.rootBlockIds.includes(placement.blockId)
    ))
    .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId));
  const viewItems = targetPositions.map((position) => ({
    id: position.blockId,
    rankKey: position.rankKey,
  }));
  const placementItems = targetPlacements.map((placement) => ({
    id: placement.blockId,
    rankKey: placement.rankKey,
  }));
  const viewRebalances = new Map<string, {
    blockId: string;
    groupKey: string | null;
    rankKey: string;
    expectedRevision: number;
  }>();
  const placementRebalances = new Map<string, {
    blockId: string;
    rankKey: string;
    expectedRevision: number;
  }>();
  const entries: {
    blockId: string;
    viewGroupKey: string | null;
    viewRankKey: string;
    rankKey: string;
    expectedBlockRevision: number;
    expectedPlacementRevision: number;
  }[] = [];

  for (const blockId of intent.rootBlockIds) {
    const record = sourceRecords.get(blockId);
    const placement = sourcePlacements.get(blockId);
    if (!record || !placement) {
      throw new Error(`BlockRecord ${blockId} is not available for Board transfer`);
    }
    const viewPlan = planFractionalRank(
      viewItems,
      blockId,
      target.beforePageId,
    );
    const placementPlan = planFractionalRank(
      placementItems,
      blockId,
      target.beforePageId,
    );
    for (const [rebalanceId, rankKey] of viewPlan.rebalancedRankKeys) {
      const position = targetPositions.find((candidate) => candidate.blockId === rebalanceId);
      if (!position) throw new Error(`Board View rebalance target ${rebalanceId} is not loaded`);
      viewRebalances.set(rebalanceId, {
        blockId: rebalanceId,
        groupKey: position.groupKey,
        rankKey,
        expectedRevision: position.revision,
      });
      const item = viewItems.find((candidate) => candidate.id === rebalanceId);
      if (item) item.rankKey = rankKey;
    }
    for (const [rebalanceId, rankKey] of placementPlan.rebalancedRankKeys) {
      const existing = targetPlacements.find((candidate) => candidate.blockId === rebalanceId);
      if (!existing) throw new Error(`Board placement rebalance target ${rebalanceId} is not loaded`);
      placementRebalances.set(rebalanceId, {
        blockId: rebalanceId,
        rankKey,
        expectedRevision: existing.revision,
      });
      const item = placementItems.find((candidate) => candidate.id === rebalanceId);
      if (item) item.rankKey = rankKey;
    }
    entries.push({
      blockId,
      viewGroupKey: target.groupKey,
      viewRankKey: viewPlan.rankKey,
      rankKey: placementPlan.rankKey,
      expectedBlockRevision: record.revision,
      expectedPlacementRevision: placement.revision,
    });
    const viewIndex = target.beforePageId === undefined
      ? viewItems.length
      : viewItems.findIndex((item) => item.id === target.beforePageId);
    const placementIndex = target.beforePageId === undefined
      ? placementItems.length
      : placementItems.findIndex((item) => item.id === target.beforePageId);
    if (viewIndex < 0 || placementIndex < 0) {
      throw new Error(`Board transfer anchor ${target.beforePageId} is not loaded`);
    }
    viewItems.splice(viewIndex, 0, { id: blockId, rankKey: viewPlan.rankKey });
    placementItems.splice(placementIndex, 0, { id: blockId, rankKey: placementPlan.rankKey });
  }

  const applyInput = allExistingPages
    ? await buildPlaceManyPagesInDataSourceApplyInput({
      operationId: intent.operationId,
      actorId: intent.clientSessionId ?? "block-transfer",
      sessionId: intent.clientSessionId ?? "block-transfer",
      dataSourceId: target.dataSourceId,
      viewId: target.viewId,
      entries,
      viewRebalances: [...viewRebalances.values()],
      placementRebalances: [...placementRebalances.values()],
    })
    : await buildPromoteManyBlockRecordApplyInput({
      operationId: intent.operationId,
      actorId: intent.clientSessionId ?? "block-transfer",
      sessionId: intent.clientSessionId ?? "block-transfer",
      dataSourceId: target.dataSourceId,
      viewId: target.viewId,
      entries,
      viewRebalances: [...viewRebalances.values()],
      placementRebalances: [...placementRebalances.values()],
    });
  const committed = await input.client.blockRecordApply({
    ...applyInput,
    ...(input.agentAuthorization
      ? { agent_authorization: input.agentAuthorization }
      : {}),
  });
  const evidence = intent.rootBlockIds.map((blockId) => {
    const record = sourceRecords.get(blockId)!;
    const titleContent = sourceWindow.content.find((content) => (
      content.blockId === blockId && (content.slot === "inline" || content.slot === "title")
    ));
    return {
      sourceBlockId: blockId,
      resultPageId: blockId,
      kind: allExistingPages ? "move" as const : "promote" as const,
      sourceBlockType: record.kind,
      semanticTitleHash: titleHash(titleContent?.content ?? record.properties.title),
      consumedPropertyKeys: [],
      bodyRootBlockIds: sourceWindow.placements
        .filter((placement) => placement.parent.kind === "block" && placement.parent.blockId === blockId)
        .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId))
        .map((placement) => placement.blockId),
      sourceToResultBlockIds: { [blockId]: blockId },
    };
  });
  const finalLocationRevisions = Object.fromEntries(entries.map((entry) => [
    entry.blockId,
    entry.expectedPlacementRevision + 1,
  ]));
  return {
    ok: true,
    value: {
      version: BLOCK_TRANSFER_CONTRACT_VERSION,
      operationId: intent.operationId,
      projectId: intent.projectId,
      storeEpoch: intent.storeEpoch,
      mode: "move",
      duplicate: committed.duplicate,
      sourceRootBlockIds: intent.rootBlockIds,
      resultRootBlockIds: intent.rootBlockIds,
      copiedBlockIds: {},
      transformationEvidence: evidence,
      finalLocations: Object.fromEntries(
        intent.rootBlockIds.map((blockId) => [blockId, {
          kind: "database" as const,
          databaseBlockId: target.dataSourceId,
        } satisfies BlockLocation]),
      ),
      finalLocationRevisions,
      documentCommits: [],
      affectedDatabaseBlockIds: [target.dataSourceId],
      changeLogSeq: committed.cursor.commit_seq,
      committedAt: committed.committed_at,
    },
  };
};

const coreFailure = (
  intent: Pick<BlockTransferIntent, "operationId">,
  error: unknown,
): BlockTransferCommandError => {
  if (!(error instanceof CoreModuleResponseError)) {
    return blockTransferFailure(
      "unknown",
      error instanceof Error ? error.message : String(error),
      { operationId: intent.operationId, retryable: true },
    );
  }
  const options = {
    operationId: intent.operationId,
    retryable: error.coreError.retryable,
  };
  switch (error.coreError.code) {
    case "invalid_input":
      return blockTransferFailure("unsupported_transfer", error.message, options);
    case "unauthorized":
      return blockTransferFailure("invalid_transfer_request", error.message, options);
    case "not_found":
      return blockTransferFailure("block_not_found", error.message, options);
    case "stale_store_epoch":
      return blockTransferFailure("store_epoch_mismatch", error.message, {
        ...options,
        reloadRequired: true,
      });
    case "idempotency_key_reused":
      return blockTransferFailure("operation_id_collision", error.message, options);
    case "revision_conflict":
    case "head_conflict":
    case "generation_conflict":
      return blockTransferFailure("source_head_mismatch", error.message, {
        ...options,
        reloadRequired: true,
      });
    case "store_corrupt":
      return blockTransferFailure("recovery_required", error.message, {
        ...options,
        reloadRequired: true,
      });
    default:
      return blockTransferFailure("unknown", error.message, options);
  }
};

export const createCoreBlockTransferAdapter = (
  input: CoreBlockTransferAdapterInput,
): CoreBlockTransferAdapter => {
  return {
    commit: async (rawIntent) => {
      let intent: BlockTransferIntent;
      try {
        intent = parseBlockTransferIntent(rawIntent);
      } catch (error) {
        return { ok: false, error: coreFailure(rawIntent, error) };
      }
      const scopeError = assertIntentScope(input, intent);
      if (scopeError) return { ok: false, error: scopeError };
      try {
        if (intent.mode === "copy") {
          const terminal = await commitCanonicalCopyIntent(input, intent);
          if (terminal !== null) return terminal;
        }
        if (intent.mode === "move" && intent.target.kind === "data_source") {
          const terminal = await commitMoveIntoDataSource(input, intent);
          if (terminal !== null) return terminal;
        }
        if (intent.mode === "move") {
          const terminal = await commitCanonicalMoveIntent(input, intent);
          if (terminal !== null) return terminal;
        }
        const committed = await input.client.libraryApply({
          operationId: intent.operationId,
          intent: {
            kind: "transfer_blocks",
            intent: toCoreIntent(intent),
            write_fence: null,
          },
        });
        const result = committed.value.block_transfer;
        if (!result || committed.receipt.operation_kind !== "transfer_blocks") {
          throw new Error("Core returned the wrong Library commit for Block transfer");
        }
        return {
          ok: true,
          value: fromCoreResult(
            intent,
            result,
            committed.receipt.duplicate,
            committed.receipt.change_log_seq,
            committed.receipt.committed_at,
          ),
        };
      } catch (error) {
        return { ok: false, error: coreFailure(intent, error) };
      }
    },
  };
};
