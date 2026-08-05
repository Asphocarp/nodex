import type { BlockNoteBlockValue } from "../block-documents/nfm-blocknote-adapter";
import type {
  BlockContentSnapshot,
  BlockPlacement,
  BlockPlacementParent,
  BlockRecord,
  BlockRecordWindow,
} from "./contracts";

const MAX_MATERIALIZED_BLOCKS = 100_000;

export class BlockRecordGraphError extends Error {
  readonly code:
    | "duplicate_record"
    | "duplicate_placement"
    | "missing_record"
    | "missing_placement"
    | "cycle"
    | "inactive_record"
    | "invalid_parent"
    | "too_many_blocks";

  constructor(code: BlockRecordGraphError["code"], message: string) {
    super(message);
    this.name = "BlockRecordGraphError";
    this.code = code;
  }
}

const parentKey = (parent: BlockPlacementParent): string => {
  switch (parent.kind) {
    case "library":
      return `library:${parent.libraryId}`;
    case "block":
      return `block:${parent.blockId}`;
    case "dataSource":
      return `data_source:${parent.dataSourceId}`;
  }
};

const comparePlacement = (left: BlockPlacement, right: BlockPlacement): number =>
  left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId);

const cloneProps = (
  properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({ ...properties });

const contentByBlock = (
  content: readonly BlockContentSnapshot[],
): Map<string, BlockContentSnapshot> => {
  const result = new Map<string, BlockContentSnapshot>();
  for (const snapshot of content) {
    if (snapshot.slot !== "inline" && snapshot.slot !== "title") continue;
    if (!result.has(snapshot.blockId) || snapshot.slot === "inline") {
      result.set(snapshot.blockId, snapshot);
    }
  }
  return result;
};

const assertWindow = (window: BlockRecordWindow): void => {
  if (window.records.length > MAX_MATERIALIZED_BLOCKS) {
    throw new BlockRecordGraphError(
      "too_many_blocks",
      `Record window contains ${window.records.length} blocks; maximum is ${MAX_MATERIALIZED_BLOCKS}`,
    );
  }

  const records = new Map<string, BlockRecord>();
  for (const record of window.records) {
    if (records.has(record.id)) {
      throw new BlockRecordGraphError(
        "duplicate_record",
        `BlockRecord ${record.id} appears more than once`,
      );
    }
    if (record.lifecycle !== "active") {
      throw new BlockRecordGraphError(
        "inactive_record",
        `BlockRecord ${record.id} is not active`,
      );
    }
    records.set(record.id, record);
  }

  const placements = new Map<string, BlockPlacement>();
  const siblingRanks = new Set<string>();
  for (const placement of window.placements) {
    if (!records.has(placement.blockId)) {
      throw new BlockRecordGraphError(
        "missing_record",
        `Placement ${placement.blockId} has no BlockRecord in the window`,
      );
    }
    if (placements.has(placement.blockId)) {
      throw new BlockRecordGraphError(
        "duplicate_placement",
        `Block ${placement.blockId} has more than one placement`,
      );
    }
    if (!placement.rankKey.trim()) {
      throw new BlockRecordGraphError(
        "invalid_parent",
        `Block ${placement.blockId} has an empty rank key`,
      );
    }
    const siblingKey = `${parentKey(placement.parent)}\u0000${placement.rankKey}`;
    if (!siblingRanks.add(siblingKey)) {
      throw new BlockRecordGraphError(
        "invalid_parent",
        `Sibling rank ${placement.rankKey} is duplicated`,
      );
    }
    placements.set(placement.blockId, placement);
  }

  for (const record of window.records) {
    if (!placements.has(record.id)) {
      throw new BlockRecordGraphError(
        "missing_placement",
        `BlockRecord ${record.id} has no placement in the window`,
      );
    }
  }

  const byParent = new Map<string, BlockPlacement[]>();
  for (const placement of placements.values()) {
    const key = parentKey(placement.parent);
    const siblings = byParent.get(key) ?? [];
    siblings.push(placement);
    byParent.set(key, siblings);
    if (placement.parent.kind === "block" && !records.has(placement.parent.blockId)) {
      throw new BlockRecordGraphError(
        "missing_record",
        `Parent Block ${placement.parent.blockId} is not in the window`,
      );
    }
  }

  for (const siblings of byParent.values()) siblings.sort(comparePlacement);

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (blockId: string): void => {
    if (visited.has(blockId)) return;
    if (visiting.has(blockId)) {
      throw new BlockRecordGraphError(
        "cycle",
        `Placement cycle includes Block ${blockId}`,
      );
    }
    visiting.add(blockId);
    const placement = placements.get(blockId);
    if (!placement) {
      throw new BlockRecordGraphError(
        "missing_placement",
        `BlockRecord ${blockId} has no placement`,
      );
    }
    if (placement.parent.kind === "block") visit(placement.parent.blockId);
    visiting.delete(blockId);
    visited.add(blockId);
  };
  for (const record of window.records) visit(record.id);
};

export const materializeBlockRecordWindow = (
  window: BlockRecordWindow,
): readonly BlockNoteBlockValue[] => {
  assertWindow(window);

  const records = new Map(window.records.map((record) => [record.id, record]));
  const childrenByParent = new Map<string, BlockPlacement[]>();
  for (const placement of window.placements) {
    const key = parentKey(placement.parent);
    const siblings = childrenByParent.get(key) ?? [];
    siblings.push(placement);
    childrenByParent.set(key, siblings);
  }
  for (const siblings of childrenByParent.values()) siblings.sort(comparePlacement);

  const content = contentByBlock(window.content);
  const visiting = new Set<string>();
  const materialize = (blockId: string): BlockNoteBlockValue => {
    const record = records.get(blockId);
    if (!record) {
      throw new BlockRecordGraphError(
        "missing_record",
        `BlockRecord ${blockId} is not in the window`,
      );
    }
    if (!visiting.add(blockId)) {
      throw new BlockRecordGraphError(
        "cycle",
        `Materialization cycle includes Block ${blockId}`,
      );
    }

    const snapshot = content.get(blockId);
    const children = (childrenByParent.get(parentKey({ kind: "block", blockId })) ?? [])
      .map((placement) => materialize(placement.blockId));
    visiting.delete(blockId);
    return {
      id: record.id,
      type: record.kind,
      props: cloneProps(record.properties),
      content: snapshot?.content ?? [],
      children,
    };
  };

  return (childrenByParent.get(parentKey(window.rootParent)) ?? [])
    .map((placement) => materialize(placement.blockId));
};
