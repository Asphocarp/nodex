import type { components } from "@nodex/core-protocol";
import type { BlockRecordCommittedValue, CoreClientPort } from "./types";
import type { NodexAgentCreatePagesCommand } from "../../shared/nodex-agent-tools";
import type { BlockRecordRead } from "../../shared/core-modules/block-record-module";
import { parseNfm } from "../../shared/nfm/parser";
import { nfmToBlockNoteWithIds } from "../../shared/block-documents/nfm-blocknote-adapter";
import {
  blockRecordSnapshotToWindow,
  buildBatchBlockRecordApplyInput,
  buildCreateBlockRecordApplyInput,
  buildReconcilePageTreeBlockRecordApplyInput,
  planFractionalRank,
  type BlockPlacementParent,
} from "../../shared/block-records";
import { parseInlineMarkdownTitle } from "../../shared/nfm/agent-title";

type BatchOperation = Exclude<
  components["schemas"]["BlockRecordOperation"],
  { readonly kind: "batch" }
>;

interface CanonicalAgentPageCreateInput {
  readonly client: CoreClientPort;
  readonly actorId: string;
  readonly authorization: components["schemas"]["AgentExecutionAuthorization"];
  readonly libraryId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly operationId: string;
  readonly sessionId: string;
  readonly command: NodexAgentCreatePagesCommand;
}

interface FlatBodyNode {
  readonly block: ReturnType<typeof nfmToBlockNoteWithIds>[number];
  readonly parentBlockId: string;
  readonly rankKey: string;
  readonly contentShardId: string;
}

const assertSnapshotBoundary = (
  snapshot: Awaited<ReturnType<CoreClientPort["blockRecordRead"]>>,
  input: CanonicalAgentPageCreateInput,
): void => {
  if (
    snapshot.library_id !== input.libraryId
    || snapshot.observed_cursor.store_epoch !== input.storeEpoch
  ) {
    throw new Error("Canonical Agent Page creation escaped its BlockRecord snapshot boundary");
  }
};

const rankChildren = (
  blocks: readonly ReturnType<typeof nfmToBlockNoteWithIds>[number][],
  parentBlockId: string,
  output: FlatBodyNode[] = [],
): readonly FlatBodyNode[] => {
  const items: { id: string; rankKey: string }[] = [];
  for (const block of blocks) {
    if (!block.id) throw new Error("Canonical Agent Page body Block is missing its ID");
    const rank = planFractionalRank(items, block.id).rankKey;
    items.push({ id: block.id, rankKey: rank });
    output.push({
      block,
      parentBlockId,
      rankKey: rank,
      contentShardId: `block-record-shard:${block.id}`,
    });
    rankChildren(block.children ?? [], block.id, output);
  }
  return output;
};

const targetDefinition = (
  input: CanonicalAgentPageCreateInput,
): {
  readonly parent: BlockPlacementParent;
  readonly beforeBlockId?: string;
  readonly view?: {
    readonly viewId: string;
    readonly dataSourceId: string;
    readonly groupKey: string | null;
    readonly beforePageId?: string;
  };
  readonly read: BlockRecordRead;
} => {
  const destination = input.command.destination;
  if (destination.kind === "space") {
    return {
      parent: { kind: "library", libraryId: input.libraryId },
      ...(destination.beforeBlockId ? { beforeBlockId: destination.beforeBlockId } : {}),
      read: {
        kind: "window",
        parent: { kind: "library" },
        include_content: false,
        include_descendants: false,
      },
    };
  }
  if (destination.kind === "document") {
    if (input.command.input.destination.kind !== "page") {
      throw new Error("Canonical Agent Page destination does not identify a Page");
    }
    return {
      parent: { kind: "block", blockId: input.command.input.destination.pageId },
      ...(destination.beforeBlockId ? { beforeBlockId: destination.beforeBlockId } : {}),
      read: {
        kind: "window",
        parent: { kind: "block", id: input.command.input.destination.pageId },
        include_content: false,
        include_descendants: false,
      },
    };
  }
  if (!destination.view) {
    throw new Error("Canonical Agent Page creation into a Data Source requires a View");
  }
  return {
    parent: { kind: "dataSource", dataSourceId: destination.dataSourceId },
    view: {
      viewId: destination.view.viewId,
      dataSourceId: destination.dataSourceId,
      groupKey: destination.view.groupKey,
      ...(destination.view.beforePageId
        ? { beforePageId: destination.view.beforePageId }
        : {}),
    },
    read: {
      kind: "window",
      parent: { kind: "data_source", id: destination.dataSourceId },
      view_id: destination.view.viewId,
      include_content: false,
      include_descendants: false,
    },
  };
};

const nonBatch = (
  operation: components["schemas"]["BlockRecordOperation"],
): BatchOperation => {
  if (operation.kind === "batch") throw new Error("Canonical Agent Page batch cannot be nested");
  return operation;
};

/**
 * Creates Agent Pages and their NFM body records in one BlockRecord Batch.
 * The old preparation still supplies stable IDs and authorization evidence;
 * this function owns the durable write and never creates a Page Document.
 */
export const commitCanonicalAgentPageCreate = async (
  input: CanonicalAgentPageCreateInput,
): Promise<BlockRecordCommittedValue> => {
  const target = targetDefinition(input);
  const snapshot = await input.client.blockRecordRead(target.read);
  assertSnapshotBoundary(snapshot, input);
  const window = blockRecordSnapshotToWindow(snapshot, target.read);
  const parent = target.parent;
  const targetRecord = parent.kind === "block"
    ? window.records.find((record) => record.id === parent.blockId)
    : undefined;
  if (parent.kind === "block" && (
    !targetRecord
    || targetRecord.kind !== "page"
    || targetRecord.lifecycle !== "active"
  )) {
    throw new Error("Canonical Agent Page destination is unavailable");
  }
  const siblingPlacements = window.placements
    .filter((placement) => {
      if (parent.kind === "library") return placement.parent.kind === "library";
      if (parent.kind === "block") {
        return placement.parent.kind === "block"
          && placement.parent.blockId === parent.blockId;
      }
      return placement.parent.kind === "dataSource"
        && placement.parent.dataSourceId === parent.dataSourceId;
    })
    .sort((left, right) => (
      left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId)
    ));
  const placementItems = siblingPlacements.map((placement) => ({
    id: placement.blockId,
    rankKey: placement.rankKey,
  }));
  const placementRevisions = new Map(
    siblingPlacements.map((placement) => [placement.blockId, placement.revision]),
  );
  const viewPositions = target.view
    ? window.viewPositions
        .filter((position) => (
          position.viewId === target.view!.viewId
          && position.groupKey === target.view!.groupKey
        ))
        .sort((left, right) => (
          left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId)
        ))
    : [];
  const viewItems = viewPositions.map((position) => ({
    id: position.blockId,
    rankKey: position.rankKey,
  }));
  const viewRevisions = new Map(
    viewPositions.map((position) => [position.blockId, position.revision]),
  );
  const operations: BatchOperation[] = [];
  for (const [index, page] of input.command.pages.entries()) {
    const draft = input.command.input.pages[index];
    if (!draft) throw new Error(`Canonical Agent Page draft ${index} is unavailable`);
    const rank = planFractionalRank(placementItems, page.pageId, target.beforeBlockId);
    const placementRebalances = [...rank.rebalancedRankKeys].map(([blockId, rankKey]) => {
      const expectedRevision = placementRevisions.get(blockId);
      if (expectedRevision === undefined) {
        throw new Error(`Canonical Agent placement ${blockId} is not loaded`);
      }
      placementRevisions.set(blockId, expectedRevision + 1);
      const item = placementItems.find((candidate) => candidate.id === blockId);
      if (item) item.rankKey = rankKey;
      return { blockId, rankKey, expectedRevision };
    });
    const insertionIndex = target.beforeBlockId === undefined
      ? placementItems.length
      : placementItems.findIndex((item) => item.id === target.beforeBlockId);
    if (insertionIndex < 0) {
      throw new Error(`Canonical Agent placement anchor ${target.beforeBlockId} is not loaded`);
    }
    placementItems.splice(insertionIndex, 0, { id: page.pageId, rankKey: rank.rankKey });
    placementRevisions.set(page.pageId, 0);

    let viewRankKey: string | undefined;
    let viewRebalances: {
      readonly blockId: string;
      readonly groupKey: string | null;
      readonly rankKey: string;
      readonly expectedRevision: number;
    }[] = [];
    if (target.view) {
      const viewRank = planFractionalRank(
        viewItems,
        page.pageId,
        target.view.beforePageId,
      );
      viewRankKey = viewRank.rankKey;
      viewRebalances = [...viewRank.rebalancedRankKeys].map(([blockId, rankKey]) => {
        const expectedRevision = viewRevisions.get(blockId);
        const position = viewPositions.find((candidate) => candidate.blockId === blockId);
        if (expectedRevision === undefined || !position) {
          throw new Error(`Canonical Agent View position ${blockId} is not loaded`);
        }
        viewRevisions.set(blockId, expectedRevision + 1);
        const item = viewItems.find((candidate) => candidate.id === blockId);
        if (item) item.rankKey = rankKey;
        return {
          blockId,
          groupKey: position.groupKey,
          rankKey,
          expectedRevision,
        };
      });
      const viewInsertionIndex = target.view.beforePageId === undefined
        ? viewItems.length
        : viewItems.findIndex((item) => item.id === target.view!.beforePageId);
      if (viewInsertionIndex < 0) {
        throw new Error(`Canonical Agent View anchor ${target.view.beforePageId} is not loaded`);
      }
      viewItems.splice(viewInsertionIndex, 0, { id: page.pageId, rankKey: viewRankKey });
      viewRevisions.set(page.pageId, 0);
    }
    const title = parseInlineMarkdownTitle(draft.title);
    const create = await buildCreateBlockRecordApplyInput({
      operationId: input.operationId,
      actorId: input.actorId,
      sessionId: input.sessionId,
      blockId: page.pageId,
      blockKind: "page",
      properties: {
        title: draft.title,
        createdBy: "nodex_agent",
        ...(draft.values && draft.values.length > 0
          ? { dataSourceValues: draft.values }
          : {}),
      },
      contentShardId: `block-record-shard:${page.pageId}`,
      parent,
      rankKey: rank.rankKey,
      materializedJson: title,
      ...(target.view
        ? {
            viewId: target.view.viewId,
            dataSourceId: target.view.dataSourceId,
            viewGroupKey: target.view.groupKey,
            viewRankKey,
            viewRebalances,
          }
        : {}),
      placementRebalances,
    });
    operations.push(nonBatch(create.operation));

    if (draft.markdown) {
      const bodyIds = [...page.bodyBlockIds];
      let bodyIndex = 0;
      const bodyBlocks = nfmToBlockNoteWithIds(parseNfm(draft.markdown), () => {
        const bodyId = bodyIds[bodyIndex++];
        if (!bodyId) throw new Error(`Canonical Agent Page body ID ${bodyIndex} is missing`);
        return bodyId;
      });
      if (bodyIndex !== bodyIds.length) {
        throw new Error(`Canonical Agent Page body ID count diverged for ${page.pageId}`);
      }
      const nodes = rankChildren(bodyBlocks, page.pageId).map((node) => ({
        block: node.block,
        parentBlockId: node.parentBlockId,
        rankKey: node.rankKey,
        contentShardId: node.contentShardId,
      }));
      const reconcile = await buildReconcilePageTreeBlockRecordApplyInput({
        operationId: input.operationId,
        actorId: input.actorId,
        sessionId: input.sessionId,
        pageId: page.pageId,
        expectedPageRevision: 0,
        nodes,
      });
      operations.push(nonBatch(reconcile.operation));
    } else if (page.bodyBlockIds.length > 0) {
      throw new Error(`Canonical Agent Page ${page.pageId} has unexpected body IDs`);
    }
  }
  const batch = await buildBatchBlockRecordApplyInput({
    operationId: input.operationId,
    actorId: input.actorId,
    sessionId: input.sessionId,
    operations,
  });
  return input.client.blockRecordApply({
    ...batch,
    agent_authorization: input.authorization,
  });
};
