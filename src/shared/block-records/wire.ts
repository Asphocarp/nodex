import type { components } from "@nodex/core-protocol";
import type {
  BlockContentSnapshot,
  BlockPlacement,
  BlockPlacementParent,
  BlockRecord,
  BlockViewPosition,
  BlockRecordWindow,
} from "./contracts";
import { blockKindFromCore } from "./kind";

type WireRead = components["schemas"]["BlockRecordRead"];
type WireSnapshot = components["schemas"]["BlockRecordReadSnapshot"];
type WireParent = components["schemas"]["BlockRecordPlacementParent"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`BlockRecord wire ${label} is invalid`);
  }
  return value;
};

const objectValue = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) throw new Error(`BlockRecord wire ${label} is invalid`);
  return value;
};

export const blockRecordParentFromWire = (
  parent: WireParent,
  libraryId = "",
): BlockPlacementParent => {
  if (parent.kind === "library") return { kind: "library", libraryId };
  if (parent.kind === "block") {
    return { kind: "block", blockId: requiredString(parent.id, "block parent id") };
  }
  return {
    kind: "dataSource",
    dataSourceId: requiredString(parent.id, "data source parent id"),
  };
};

const blockRecordFromWire = (
  value: WireSnapshot["graph"]["blocks"][number],
): BlockRecord => ({
  id: requiredString(value.id, "block id"),
  libraryId: requiredString(value.library_id, "block library id"),
  kind: blockKindFromCore(
    requiredString(value.kind, "block kind"),
    objectValue(value.properties, "block properties"),
  ),
  lifecycle: value.lifecycle === "active"
    || value.lifecycle === "archived"
    || value.lifecycle === "retired"
    ? value.lifecycle
    : (() => { throw new Error("BlockRecord wire block lifecycle is invalid"); })(),
  properties: objectValue(value.properties, "block properties"),
  contentShardId: requiredString(value.content_shard_id, "content shard id"),
  revision: value.revision,
});

const placementFromWire = (
  value: WireSnapshot["graph"]["placements"][number],
  libraryId: string,
): BlockPlacement => ({
  blockId: requiredString(value.block_id, "placement block id"),
  parent: blockRecordParentFromWire(value.parent, libraryId),
  rankKey: requiredString(value.rank_key, "placement rank key"),
  revision: value.revision,
});

const viewPositionFromWire = (
  value: WireSnapshot["view_positions"][number],
): BlockViewPosition => ({
  viewId: requiredString(value.view_id, "view position id"),
  dataSourceId: requiredString(value.data_source_id, "view position Data Source id"),
  blockId: requiredString(value.block_id, "view position block id"),
  groupKey: value.group_key ?? null,
  rankKey: requiredString(value.rank_key, "view position rank key"),
  revision: value.revision,
});

const contentFromWire = (
  value: WireSnapshot["content"][number],
): BlockContentSnapshot => ({
  blockId: requiredString(value.block_id, "content block id"),
  slot: requiredString(value.slot, "content slot"),
  content: value.materialized_json ?? [],
  crdt: {
    fullStateV1: value.full_state_v1,
    stateVectorV1: value.state_vector_v1,
    stateHash: value.state_hash,
  },
  shardId: requiredString(value.shard_id, "content shard id"),
  head: value.revision,
});

export const blockRecordSnapshotToWindow = (
  snapshot: WireSnapshot,
  read: WireRead,
): BlockRecordWindow => {
  const rootParent = read.parent
    ? blockRecordParentFromWire(read.parent, snapshot.library_id)
    : { kind: "library", libraryId: snapshot.library_id } as const;
  return {
    libraryId: requiredString(snapshot.library_id, "library id"),
    rootParent,
    viewId: read.view_id ?? null,
    records: snapshot.graph.blocks.map(blockRecordFromWire),
    placements: snapshot.graph.placements.map((placement) =>
      placementFromWire(placement, snapshot.library_id)
    ),
    viewPositions: snapshot.view_positions.map(viewPositionFromWire),
    content: snapshot.content.map(contentFromWire),
    observedLocalCommit: {
      storeEpoch: requiredString(snapshot.observed_cursor.store_epoch, "observed store epoch"),
      commitSeq: snapshot.observed_cursor.commit_seq,
    },
    continuation: null,
  };
};
