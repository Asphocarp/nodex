import type { LocalCommitEnvelope } from "../local-commit";
import type {
  BlockPlacementParent,
  BlockRecordWindow,
} from "./contracts";

export type BlockRecordWindowCommitResult =
  | { readonly kind: "applied"; readonly window: BlockRecordWindow }
  | { readonly kind: "ignored"; readonly window: BlockRecordWindow }
  | {
    readonly kind: "requires_read";
    readonly reason: string;
    readonly window: BlockRecordWindow;
  };

const parentFromLocalKey = (key: string, libraryId: string): BlockPlacementParent => {
  if (key === "library") return { kind: "library", libraryId };
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) {
    throw new Error(`LocalCommit placement parent key is invalid: ${key}`);
  }
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (kind === "block") return { kind: "block", blockId: id };
  if (kind === "data_source") return { kind: "dataSource", dataSourceId: id };
  throw new Error(`LocalCommit placement parent kind is unsupported: ${kind}`);
};

const sameCursor = (
  left: BlockRecordWindow["observedLocalCommit"],
  right: LocalCommitEnvelope["cursor"],
): boolean => left.storeEpoch === right.storeEpoch && left.commitSeq === right.commitSeq;

const parentKey = (parent: BlockPlacementParent): string => {
  if (parent.kind === "library") return "library";
  if (parent.kind === "block") return `block:${parent.blockId}`;
  return `data_source:${parent.dataSourceId}`;
};

const windowParentKey = (window: BlockRecordWindow): string => parentKey(window.rootParent);

const isWindowRootAnchor = (window: BlockRecordWindow, blockId: string): boolean =>
  window.rootParent.kind === "block" && window.rootParent.blockId === blockId;

const applyRecordDelta = (
  current: BlockRecordWindow["records"][number] | undefined,
  value: Extract<LocalCommitEnvelope["effects"][number], { kind: "record" }>["value"],
): BlockRecordWindow["records"][number] => {
  if (current) {
    return {
      ...current,
      kind: value.kind,
      lifecycle: value.lifecycle,
      ...(value.libraryId ? { libraryId: value.libraryId } : {}),
      ...(value.properties ? { properties: value.properties } : {}),
      ...(value.contentShardId ? { contentShardId: value.contentShardId } : {}),
      revision: value.revision,
    };
  }
  if (!value.libraryId || !value.properties || !value.contentShardId) {
    throw new Error(`Record ${value.blockId} is missing rich fields`);
  }
  return {
    id: value.blockId,
    libraryId: value.libraryId,
    kind: value.kind,
    lifecycle: value.lifecycle,
    properties: value.properties,
    contentShardId: value.contentShardId,
    revision: value.revision,
  };
};

export const applyLocalCommitToBlockRecordWindow = (
  window: BlockRecordWindow,
  envelope: LocalCommitEnvelope,
): BlockRecordWindowCommitResult => {
  if (envelope.cursor.storeEpoch !== window.observedLocalCommit.storeEpoch) {
    return {
      kind: "requires_read",
      reason: "LocalCommit belongs to another store epoch",
      window,
    };
  }
  if (
    envelope.cursor.commitSeq < window.observedLocalCommit.commitSeq
    || sameCursor(window.observedLocalCommit, envelope.cursor)
  ) {
    return { kind: "ignored", window };
  }

  const records = new Map(window.records.map((record) => [record.id, record]));
  const placements = new Map(window.placements.map((placement) => [placement.blockId, placement]));
  const viewPositions = new Map(
    window.viewPositions.map((position) => [position.blockId, position]),
  );
  const content = new Map(
    window.content.map((snapshot) => [`${snapshot.blockId}:${snapshot.slot}`, snapshot]),
  );
  const pendingRecords = new Map<string, LocalCommitWindowRecord>();
  const removedRecordIds = new Set<string>();
  const rootKey = windowParentKey(window);

  type LocalCommitWindowRecord = BlockRecordWindow["records"][number];

  for (const effect of envelope.effects) {
    if (effect.kind === "record") {
      const current = records.get(effect.value.blockId);
      if (current) {
        try {
          records.set(effect.value.blockId, applyRecordDelta(current, effect.value));
        } catch (error) {
          return {
            kind: "requires_read",
            reason: error instanceof Error ? error.message : String(error),
            window,
          };
        }
      } else {
        try {
          pendingRecords.set(
            effect.value.blockId,
            applyRecordDelta(undefined, effect.value),
          );
        } catch (error) {
          return {
            kind: "requires_read",
            reason: error instanceof Error ? error.message : String(error),
            window,
          };
        }
      }
      continue;
    }
    if (effect.kind === "placement") {
      const destinationInWindow = effect.value.to === rootKey;
      const current = placements.get(effect.value.blockId);
      if (!destinationInWindow) {
        if (!current) continue;
        if (isWindowRootAnchor(window, effect.value.blockId)) {
          return {
            kind: "requires_read",
            reason: `The BlockRecord window root ${effect.value.blockId} moved away`,
            window,
          };
        }
        placements.delete(effect.value.blockId);
        viewPositions.delete(effect.value.blockId);
        records.delete(effect.value.blockId);
        pendingRecords.delete(effect.value.blockId);
        removedRecordIds.add(effect.value.blockId);
        continue;
      }

      const record = records.get(effect.value.blockId) ?? pendingRecords.get(effect.value.blockId);
      if (!record) {
        return {
          kind: "requires_read",
          reason: `Placement ${effect.value.blockId} is missing its rich record`,
          window,
        };
      }
      records.set(effect.value.blockId, record);
      placements.set(effect.value.blockId, {
        ...(current ?? { blockId: effect.value.blockId }),
        parent: parentFromLocalKey(effect.value.to, window.libraryId),
        rankKey: effect.value.rankKey,
        revision: effect.value.revision,
      });
      continue;
    }
    if (effect.kind === "data_source") {
      return {
        kind: "requires_read",
        reason: `Data Source ${effect.value.dataSourceId} is outside this BlockRecord window`,
        window,
      };
    }
    if (effect.kind === "remove") {
      if (isWindowRootAnchor(window, effect.value.blockId)) {
        return {
          kind: "requires_read",
          reason: `The BlockRecord window root ${effect.value.blockId} was removed`,
          window,
        };
      }
      records.delete(effect.value.blockId);
      placements.delete(effect.value.blockId);
      viewPositions.delete(effect.value.blockId);
      pendingRecords.delete(effect.value.blockId);
      removedRecordIds.add(effect.value.blockId);
      continue;
    }
    if (effect.kind === "view_position") {
      if (window.viewId !== effect.value.viewId) continue;
      viewPositions.set(effect.value.blockId, {
        viewId: effect.value.viewId,
        dataSourceId: effect.value.dataSourceId,
        blockId: effect.value.blockId,
        groupKey: effect.value.groupKey,
        rankKey: effect.value.rankKey,
        revision: effect.value.revision,
      });
      continue;
    }
    if (effect.kind === "content") {
      const record = records.get(effect.value.blockId) ?? pendingRecords.get(effect.value.blockId);
      if (!record) {
        return {
          kind: "requires_read",
          reason: `Content ${effect.value.blockId} targets a BlockRecord outside this window`,
          window,
        };
      }
      const key = `${effect.value.blockId}:${effect.value.slot}`;
      const current = content.get(key);
      if (!current && effect.value.materializedJson === undefined) {
        return {
          kind: "requires_read",
          reason: `Content ${key} is missing from this BlockRecord window`,
          window,
        };
      }
      const base = current ?? {
        blockId: effect.value.blockId,
        slot: effect.value.slot,
        content: [],
        shardId: effect.value.shardId,
        head: 0,
      };
      content.set(key, {
        ...base,
        content: effect.value.materializedJson === undefined
          ? base.content
          : effect.value.materializedJson,
        head: effect.value.head,
        ...(base.crdt && effect.value.stateHash !== undefined
          ? {
            crdt: {
              ...base.crdt,
              ...(effect.value.stateHash === null
                ? {}
                : { stateHash: effect.value.stateHash }),
            },
          }
          : {}),
      });
      continue;
    }
    return {
      kind: "requires_read",
      reason: `LocalCommit effect ${effect.kind} is not materialized by the BlockRecord window reducer`,
      window,
    };
  }
  return {
    kind: "applied",
    window: {
      ...window,
      records: [...records.values()],
      placements: [...placements.values()],
      viewPositions: [...viewPositions.values()],
      content: [...content.values()].filter((item) => !removedRecordIds.has(item.blockId)),
      observedLocalCommit: envelope.cursor,
    },
  };
};
