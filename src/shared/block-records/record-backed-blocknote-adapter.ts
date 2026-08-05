import type { BlockNoteBlockValue } from "../block-documents/nfm-blocknote-adapter";
import { materializeBlockRecordWindow } from "./record-graph";
import type { BlockRecordWindow } from "./contracts";

export interface RecordBackedBlockNoteMaterialization {
  readonly blocks: readonly BlockNoteBlockValue[];
  readonly blockIds: readonly string[];
  readonly observedLocalCommit: BlockRecordWindow["observedLocalCommit"];
}

export interface RecordBackedBlockNoteReconciliation {
  readonly materialization: RecordBackedBlockNoteMaterialization;
  readonly addedBlockIds: readonly string[];
  readonly removedBlockIds: readonly string[];
  readonly changedBlockIds: readonly string[];
}

export interface RecordBackedBlockNoteAdapter {
  materialize(window: BlockRecordWindow): RecordBackedBlockNoteMaterialization;
  reconcile(
    previous: BlockRecordWindow,
    next: BlockRecordWindow,
  ): RecordBackedBlockNoteReconciliation;
}

const collectIds = (
  blocks: readonly BlockNoteBlockValue[],
  result: string[] = [],
): readonly string[] => {
  for (const block of blocks) {
    if (!block.id) throw new Error("Record-backed BlockNote block is missing its stable ID");
    result.push(block.id);
    collectIds(block.children ?? [], result);
  }
  return result;
};

const uniqueIds = (blocks: readonly BlockNoteBlockValue[]): readonly string[] => {
  const ids = collectIds(blocks);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw new Error("Record-backed BlockNote materialization contains duplicate Block IDs");
  }
  return ids;
};

const recordFingerprint = (
  window: BlockRecordWindow,
): ReadonlyMap<string, string> => new Map(
  window.records.map((record) => [
    record.id,
    JSON.stringify({
      kind: record.kind,
      lifecycle: record.lifecycle,
      properties: record.properties,
      revision: record.revision,
    }),
  ]),
);

const materialize = (
  window: BlockRecordWindow,
): RecordBackedBlockNoteMaterialization => {
  const blocks = materializeBlockRecordWindow(window);
  return {
    blocks,
    blockIds: uniqueIds(blocks),
    observedLocalCommit: window.observedLocalCommit,
  };
};

export const createRecordBackedBlockNoteAdapter = (): RecordBackedBlockNoteAdapter => ({
  materialize,
  reconcile: (previous, next) => {
    const previousMaterialization = materialize(previous);
    const nextMaterialization = materialize(next);
    const previousIds = new Set(previousMaterialization.blockIds);
    const nextIds = new Set(nextMaterialization.blockIds);
    const previousFingerprints = recordFingerprint(previous);
    const nextFingerprints = recordFingerprint(next);
    return {
      materialization: nextMaterialization,
      addedBlockIds: nextMaterialization.blockIds.filter((id) => !previousIds.has(id)),
      removedBlockIds: previousMaterialization.blockIds.filter((id) => !nextIds.has(id)),
      changedBlockIds: nextMaterialization.blockIds.filter((id) => (
        previousIds.has(id)
        && previousFingerprints.get(id) !== nextFingerprints.get(id)
      )),
    };
  },
});
