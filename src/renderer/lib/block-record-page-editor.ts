import type {
  BlockTransferCommandResult,
  BlockTransferErrorCode,
} from "../../shared/block-transfer";
import type { PublicBlockTransferIntent } from "../../shared/block-transfer-transport";
import type { BlockNoteBlockValue } from "../../shared/block-documents/nfm-blocknote-adapter";
import {
  buildMoveManyBlockRecordApplyInput,
  buildReconcilePageTreeBlockRecordApplyInput,
  buildSetMaterializedContentBlockRecordApplyInput,
  type SetMaterializedContentBlockRecordApplyInput,
} from "../../shared/block-records/apply-request";
import {
  materializeBlockRecordWindow,
  type BlockContentSnapshot,
  type BlockRecordWindow,
} from "../../shared/block-records";
import type { BlockRecordWindowStore } from "./block-record-window-store";
import { planFractionalRank } from "../../shared/block-records/fractional-rank";
import { blockKindToCore } from "../../shared/block-records/kind";
import {
  plainTextToPortableRichText,
  portableRichTextPlainText,
} from "../../shared/block-documents/portable-rich-text";

const jsonEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const contentFor = (
  window: BlockRecordWindow,
  blockId: string,
  preferredSlot: "title" | "inline",
): BlockContentSnapshot | undefined =>
  window.content.find((candidate) =>
    candidate.blockId === blockId && candidate.slot === preferredSlot,
  ) ?? window.content.find((candidate) => candidate.blockId === blockId);

interface TreeEntry {
  readonly block: BlockNoteBlockValue;
  readonly parentBlockId: string;
}

const flattenTree = (
  blocks: readonly BlockNoteBlockValue[],
  parentBlockId: string,
  result: TreeEntry[] = [],
): readonly TreeEntry[] => {
  for (const block of blocks) {
    result.push({ block, parentBlockId });
    flattenTree(block.children ?? [], block.id ?? "", result);
  }
  return result;
};

const textFromContent = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  try {
    return portableRichTextPlainText(value);
  } catch {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item !== "object" || item === null) return "";
        const text = (item as { readonly text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
};

const transferFailure = (
  operationId: string,
  code: BlockTransferErrorCode,
  message: string,
): BlockTransferCommandResult<unknown> => ({
  ok: false,
  error: {
    code,
    message,
    retryable: false,
    reloadRequired: false,
    operationId,
  },
});

export interface RecordBackedPageEditorSessionOptions {
  readonly pageId: string;
  readonly windowStore: BlockRecordWindowStore;
  readonly actorId: string;
  readonly sessionId: string;
  readonly createOperationId?: () => string;
}

/**
 * The Page editor's durable seam. It deliberately exposes a BlockRecord
 * window, not a Page-owned Y.Doc. BlockNote remains an editor/cache adapter;
 * every durable change enters Core as a typed operation.
 */
export interface RecordBackedPageEditorSession {
  readonly pageId: string;
  readonly windowStore: BlockRecordWindowStore;
  load(): Promise<BlockRecordWindow>;
  bodyBlocks(window?: BlockRecordWindow): readonly BlockNoteBlockValue[];
  title(window?: BlockRecordWindow): string;
  saveTitle(value: string): Promise<void>;
  saveBody(blocks: readonly BlockNoteBlockValue[]): Promise<void>;
  moveBlocksToPage(
    blockIds: readonly string[],
    targetPageId: string,
    options?: {
      readonly parentBlockId?: string;
      readonly beforeBlockId?: string;
    },
  ): Promise<void>;
  transfer(intent: PublicBlockTransferIntent): Promise<BlockTransferCommandResult<unknown>>;
}

const pageRead = (pageId: string) => ({
  kind: "window" as const,
  parent: { kind: "block" as const, id: pageId },
  include_content: true,
  include_descendants: true,
});

const readCurrentWindow = async (
  session: RecordBackedPageEditorSessionOptions,
): Promise<BlockRecordWindow> => {
  const current = session.windowStore.getSnapshot();
  if (current && current.rootParent.kind === "block" && current.rootParent.blockId === session.pageId) {
    return current;
  }
  return await session.windowStore.load(pageRead(session.pageId));
};

const contentMutation = async (
  options: RecordBackedPageEditorSessionOptions,
  snapshot: BlockContentSnapshot,
  value: unknown,
): Promise<void> => {
  const input: SetMaterializedContentBlockRecordApplyInput = {
    operationId: options.createOperationId?.() ?? crypto.randomUUID(),
    actorId: options.actorId,
    sessionId: options.sessionId,
    blockId: snapshot.blockId,
    slot: snapshot.slot === "title" ? "title" : "inline",
    materializedJson: value,
    expectedRevision: snapshot.head,
  };
  await options.windowStore.apply(
    await buildSetMaterializedContentBlockRecordApplyInput(input),
  );
};

export const createRecordBackedPageEditorSession = (
  options: RecordBackedPageEditorSessionOptions,
): RecordBackedPageEditorSession => {
  const session: RecordBackedPageEditorSession = {
    pageId: options.pageId,
    windowStore: options.windowStore,
    load: () => options.windowStore.load(pageRead(options.pageId)),
    bodyBlocks: (window = options.windowStore.getSnapshot() ?? undefined) => {
      if (!window) return [];
      return materializeBlockRecordWindow(window);
    },
    title: (window = options.windowStore.getSnapshot() ?? undefined) => {
      if (!window) return "";
      const snapshot = contentFor(window, options.pageId, "title");
      return textFromContent(snapshot?.content);
    },
    saveTitle: async (value) => {
      const window = await readCurrentWindow(options);
      const snapshot = contentFor(window, options.pageId, "title");
      if (!snapshot) throw new Error("Page title content is not available");
      const next = plainTextToPortableRichText(value);
      if (jsonEqual(snapshot.content, next)) return;
      await contentMutation(options, snapshot, next);
    },
    saveBody: async (blocks) => {
      const window = await readCurrentWindow(options);
      const currentRecords = new Map(window.records.map((record) => [record.id, record]));
      const currentPlacements = new Map(
        window.placements.map((placement) => [placement.blockId, placement]),
      );
      const rankByBlock = new Map<string, string>();
      const entries = flattenTree(blocks, options.pageId).map((entry) => entry);
      const desiredByParent = new Map<string, string[]>();
      for (const entry of entries) {
        if (!entry.block.id) continue;
        const siblings = desiredByParent.get(entry.parentBlockId) ?? [];
        siblings.push(entry.block.id);
        desiredByParent.set(entry.parentBlockId, siblings);
      }
      for (const [parentBlockId, desiredIds] of desiredByParent) {
        const desiredSet = new Set(desiredIds);
        let working = window.placements
          .filter((placement) => (
            placement.parent.kind === "block"
            && placement.parent.blockId === parentBlockId
            && desiredSet.has(placement.blockId)
          ))
          .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId))
          .map((placement) => ({ id: placement.blockId, rankKey: placement.rankKey }));
        for (let index = desiredIds.length - 1; index >= 0; index -= 1) {
          const blockId = desiredIds[index]!;
          const beforeBlockId = desiredIds[index + 1];
          const plan = planFractionalRank(working, blockId, beforeBlockId);
          for (const [rebalancedId, rankKey] of plan.rebalancedRankKeys) {
            rankByBlock.set(rebalancedId, rankKey);
          }
          rankByBlock.set(blockId, plan.rankKey);
          const effective = working.map((item) => ({
            ...item,
            rankKey: plan.rebalancedRankKeys.get(item.id) ?? item.rankKey,
          })).filter((item) => item.id !== blockId);
          const insertionIndex = beforeBlockId === undefined
            ? effective.length
            : effective.findIndex((item) => item.id === beforeBlockId);
          if (insertionIndex < 0) throw new Error(`Move anchor ${beforeBlockId} is not loaded`);
          effective.splice(insertionIndex, 0, { id: blockId, rankKey: plan.rankKey });
          working = effective;
        }
      }

      const inputNodes = entries.map((entry) => {
        const blockId = entry.block.id;
        if (!blockId) throw new Error("Page tree Block is missing its stable ID");
        const record = currentRecords.get(blockId);
        const placement = currentPlacements.get(blockId);
        const preferredSlot = blockKindToCore(entry.block.type) === "page" ? "title" : "inline";
        const snapshot = record
          ? contentFor(window, blockId, preferredSlot)
          : undefined;
        return {
          block: entry.block,
          parentBlockId: entry.parentBlockId === options.pageId ? null : entry.parentBlockId,
          rankKey: rankByBlock.get(blockId) ?? placement?.rankKey ?? "80000000000000000000000000000000",
          contentShardId: record?.contentShardId ?? `block-record-shard:${blockId}`,
          ...(record && placement && snapshot
            ? {
              expectedBlockRevision: record.revision,
              expectedPlacementRevision: placement.revision,
              expectedContentRevision: snapshot.head,
            }
            : {}),
        };
      });
      const pageRecord = currentRecords.get(options.pageId);
      if (!pageRecord) throw new Error("Page root is not loaded");
      await options.windowStore.apply(
        await buildReconcilePageTreeBlockRecordApplyInput({
          operationId: options.createOperationId?.() ?? crypto.randomUUID(),
          actorId: options.actorId,
          sessionId: options.sessionId,
          pageId: options.pageId,
          expectedPageRevision: pageRecord.revision,
          nodes: inputNodes,
        }),
      );
    },
    moveBlocksToPage: async (blockIds, targetPageId, moveOptions = {}) => {
      if (blockIds.length === 0) return;
      if (targetPageId === options.pageId) {
        throw new Error("Choose a different destination Page.");
      }
      const sourceWindow = await readCurrentWindow(options);
      const targetWindow = await options.windowStore.read({
        ...pageRead(targetPageId),
        include_content: false,
      });
      const sourceRecords = new Map(sourceWindow.records.map((record) => [record.id, record]));
      const sourcePlacements = new Map(sourceWindow.placements.map((placement) => [placement.blockId, placement]));
      const targetParentId = moveOptions.parentBlockId ?? targetPageId;
      const selected = new Set(blockIds);
      for (const blockId of blockIds) {
        let parent = sourcePlacements.get(blockId)?.parent;
        while (parent?.kind === "block") {
          if (selected.has(parent.blockId)) {
            throw new Error("Move selection contains both a Block and its descendant");
          }
          parent = sourcePlacements.get(parent.blockId)?.parent;
        }
      }
      const targetPlacements = targetWindow.placements
        .filter((placement) => placement.parent.kind === "block" && placement.parent.blockId === targetParentId)
        .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId));
      const items = targetPlacements.map((placement) => ({
        id: placement.blockId,
        rankKey: placement.rankKey,
      }));
      const targetPlacementById = new Map(
        targetPlacements.map((placement) => [placement.blockId, placement]),
      );
      const placementRebalances = new Map<string, {
        blockId: string;
        rankKey: string;
        expectedRevision: number;
      }>();
      const entries = [] as {
        blockId: string;
        targetParent: { kind: "block"; blockId: string };
        rankKey: string;
        expectedBlockRevision: number;
        expectedPlacementRevision: number;
      }[];
      for (const blockId of blockIds) {
        const record = sourceRecords.get(blockId);
        const placement = sourcePlacements.get(blockId);
        if (!record || !placement) throw new Error(`BlockRecord ${blockId} is not loaded`);
        const plan = planFractionalRank(items, blockId, moveOptions.beforeBlockId);
        for (const [rebalanceId, rankKey] of plan.rebalancedRankKeys) {
          const targetPlacement = targetPlacementById.get(rebalanceId);
          if (!targetPlacement) {
            throw new Error(`Placement rebalance target ${rebalanceId} is not loaded`);
          }
          placementRebalances.set(rebalanceId, {
            blockId: rebalanceId,
            rankKey,
            expectedRevision: targetPlacement.revision,
          });
          const item = items.find((candidate) => candidate.id === rebalanceId);
          if (item) item.rankKey = rankKey;
        }
        const targetParent = { kind: "block" as const, blockId: targetParentId };
        entries.push({
          blockId,
          targetParent,
          rankKey: plan.rankKey,
          expectedBlockRevision: record.revision,
          expectedPlacementRevision: placement.revision,
        });
        const index = moveOptions.beforeBlockId === undefined
          ? items.length
          : items.findIndex((item) => item.id === moveOptions.beforeBlockId);
        if (index < 0) throw new Error(`Move anchor ${moveOptions.beforeBlockId} is not loaded`);
        items.splice(index, 0, { id: blockId, rankKey: plan.rankKey });
        sourceRecords.delete(blockId);
        sourcePlacements.delete(blockId);
      }
      await options.windowStore.apply(
        await buildMoveManyBlockRecordApplyInput({
          operationId: options.createOperationId?.() ?? crypto.randomUUID(),
          actorId: options.actorId,
          sessionId: options.sessionId,
          entries,
          placementRebalances: [...placementRebalances.values()],
        }),
      );
    },
    transfer: async (intent): Promise<BlockTransferCommandResult<unknown>> => {
      if (intent.mode === "copy") {
        return transferFailure(intent.operationId, "unsupported_transfer", "Copying into a record-backed Page is not implemented yet.");
      }
      if (intent.target.kind !== "page") {
        return transferFailure(intent.operationId, "invalid_target", "A record-backed Page accepts only Page destinations.");
      }
      await session.moveBlocksToPage(intent.rootBlockIds, intent.target.pageId, {
        ...(intent.target.parentBlockId ? { parentBlockId: intent.target.parentBlockId } : {}),
        ...(intent.target.beforeBlockId ? { beforeBlockId: intent.target.beforeBlockId } : {}),
      });
      return { ok: true, value: {} };
    },
  };
  return session;
};
