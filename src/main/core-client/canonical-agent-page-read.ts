import type { BlockRecordWindow } from "../../shared/block-records";
import {
  blockRecordSnapshotToWindow,
  type BlockRecord,
  type BlockPlacement,
} from "../../shared/block-records";
import type { CoreClientPort } from "./types";
import type { components } from "@nodex/core-protocol";

export interface CanonicalAgentPageRead {
  readonly pageId: string | null;
  readonly target: BlockRecord;
  readonly targetPlacement: BlockPlacement;
  readonly window: BlockRecordWindow;
}

const readBlock = async (
  client: CoreClientPort,
  blockId: string,
  includeContent: boolean,
  authorization: components["schemas"]["AgentExecutionAuthorization"],
): Promise<BlockRecordWindow> => {
  const read = {
    kind: "window" as const,
    block_ids: [blockId],
    include_content: includeContent,
    include_descendants: false,
  };
  return blockRecordSnapshotToWindow(
    await client.blockRecordRead(read, authorization),
    read,
  );
};

const findRecord = (
  window: BlockRecordWindow,
  blockId: string,
): BlockRecord => {
  const record = window.records.find((candidate) => candidate.id === blockId);
  if (!record) throw new Error(`Canonical Block ${blockId} was not found`);
  return record;
};

const findPlacement = (
  window: BlockRecordWindow,
  blockId: string,
): BlockPlacement => {
  const placement = window.placements.find((candidate) => candidate.blockId === blockId);
  if (!placement) throw new Error(`Canonical placement for Block ${blockId} was not found`);
  return placement;
};

/**
 * Resolves a target Block through the canonical owning forest and then reads
 * one bounded Page window. The ancestor walk is intentionally batched one
 * Block ID per read until Core exposes a first-class owner-closure read; it
 * never consults a Page Document/Yjs head to discover ownership or content.
 */
export const readCanonicalAgentPage = async (
  client: CoreClientPort,
  targetBlockId: string,
  authorization: components["schemas"]["AgentExecutionAuthorization"],
): Promise<CanonicalAgentPageRead> => {
  const visited = new Set<string>();
  let currentWindow = await readBlock(client, targetBlockId, true, authorization);
  let currentId = targetBlockId;
  const target = findRecord(currentWindow, targetBlockId);
  const targetPlacement = findPlacement(currentWindow, targetBlockId);
  let pageId: string | null = target.kind === "page" ? target.id : null;

  while (pageId === null) {
    if (!visited.add(currentId)) throw new Error("Canonical Block ownership cycle detected");
    const placement = findPlacement(currentWindow, currentId);
    if (placement.parent.kind !== "block") break;
    currentId = placement.parent.blockId;
    currentWindow = await readBlock(client, currentId, true, authorization);
    const ancestor = findRecord(currentWindow, currentId);
    if (ancestor.kind === "page") pageId = ancestor.id;
  }

  if (pageId === null) {
    return {
      pageId: null,
      target,
      targetPlacement,
      window: currentWindow,
    };
  }

  const read = {
    kind: "window" as const,
    parent: { kind: "block" as const, id: pageId },
    include_content: true,
    include_descendants: true,
  };
  const window = blockRecordSnapshotToWindow(
    await client.blockRecordRead(read, authorization),
    read,
  );
  return {
    pageId,
    target: findRecord(window, targetBlockId),
    targetPlacement: findPlacement(window, targetBlockId),
    window,
  };
};
