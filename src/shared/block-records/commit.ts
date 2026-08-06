import type { components } from "@nodex/core-protocol";
import type {
  LocalCommitAudience,
  LocalCommitEffect,
  LocalCommitEnvelope,
} from "../local-commit";

type BlockRecordCommittedValue = components["schemas"]["BlockRecordCommittedValue"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`BlockRecord LocalCommit ${label} is invalid`);
  }
  return value;
};

const parentKey = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (!isRecord(value)) throw new Error("BlockRecord placement parent is invalid");
  const kind = requiredString(value.kind, "placement parent kind");
  if (kind === "library") return "library";
  return `${kind}:${requiredString(value.id, "placement parent id")}`;
};

const audience = (value: unknown): LocalCommitAudience => {
  if (!isRecord(value)) throw new Error("BlockRecord LocalCommit audience is invalid");
  const kind = value.kind;
  const projectIds = value.projectIds;
  if (
    (kind !== "library" && kind !== "projects")
    || !Array.isArray(projectIds)
    || projectIds.some((projectId) => typeof projectId !== "string")
  ) {
    throw new Error("BlockRecord LocalCommit audience is invalid");
  }
  return { kind, projectIds };
};

const nonNegativeRevision = (value: unknown, label: string): number => {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new Error(`BlockRecord ${label} revision is invalid`);
  }
  return value;
};

const effect = (kind: string, value: unknown): LocalCommitEffect[] => {
  if (!isRecord(value)) throw new Error("BlockRecord LocalCommit effect is invalid");
  if (kind === "data_source") {
    return [{
      kind: "data_source",
      value: { dataSourceId: requiredString(value.dataSourceId, "data source id") },
    }];
  }
  if (kind === "view_position") {
    return [{
      kind: "view_position",
      value: {
        viewId: requiredString(value.viewId, "view id"),
        dataSourceId: requiredString(value.dataSourceId, "view Data Source id"),
        blockId: requiredString(value.blockId, "view position block id"),
        groupKey: value.groupKey === null || value.groupKey === undefined
          ? null
          : requiredString(value.groupKey, "view group key"),
        rankKey: requiredString(value.rankKey, "view rank key"),
        revision: nonNegativeRevision(value.revision, "view position"),
      },
    }];
  }
  if (kind === "view_position_remove") {
    return [{
      kind: "view_position_remove",
      value: {
        viewId: requiredString(value.viewId, "removed view id"),
        dataSourceId: requiredString(value.dataSourceId, "removed view Data Source id"),
        blockId: requiredString(value.blockId, "removed view position block id"),
        revision: nonNegativeRevision(value.revision, "removed view position"),
      },
    }];
  }
  if (kind === "property_values") {
    if (!Array.isArray(value.values)) {
      throw new Error("BlockRecord property values are invalid");
    }
    const values = value.values.map((entry) => {
      if (!isRecord(entry)) {
        throw new Error("BlockRecord property value entry is invalid");
      }
      return {
        propertyId: requiredString(entry.propertyId, "property id"),
        value: entry.value,
        revision: nonNegativeRevision(entry.revision, "property value"),
      };
    });
    return [{
      kind: "property_values",
      value: {
        blockId: requiredString(value.blockId, "property values block id"),
        dataSourceId: requiredString(value.dataSourceId, "property values Data Source id"),
        values,
        revision: nonNegativeRevision(value.revision, "property values record"),
      },
    }];
  }
  if (kind === "content") {
    const materializedJson = value.materializedJson;
    const stateHash = value.stateHash === undefined || value.stateHash === null
      ? value.stateHash
      : requiredString(value.stateHash, "content state hash");
    return [{
      kind: "content",
      value: {
        blockId: requiredString(value.blockId, "content block id"),
        slot: requiredString(value.slot, "content slot"),
        shardId: requiredString(value.shardId, "content shard id"),
        head: nonNegativeRevision(value.head, "content"),
        ...(stateHash === undefined
          ? {}
          : { stateHash }),
        ...(materializedJson === undefined ? {} : { materializedJson }),
      },
    }];
  }
  if (kind === "database") {
    const databaseValue = value.value;
    const receipt = value.receipt;
    if (
      !isRecord(databaseValue)
      || !isRecord(receipt)
      || typeof value.event_sequence !== "number"
      || !Number.isSafeInteger(value.event_sequence)
      || value.event_sequence < 0
      || typeof value.store_epoch !== "string"
      || !value.store_epoch.trim()
    ) {
      throw new Error("BlockRecord Database effect is invalid");
    }
    return [{
      kind: "database",
      value: {
        value: databaseValue,
        receipt,
        eventSequence: value.event_sequence,
        storeEpoch: value.store_epoch,
      },
    }];
  }
  if (kind === "library") {
    const libraryValue = value.value;
    const receipt = value.receipt;
    if (
      !isRecord(libraryValue)
      || !isRecord(receipt)
      || typeof value.event_sequence !== "number"
      || !Number.isSafeInteger(value.event_sequence)
      || value.event_sequence < 0
      || typeof value.store_epoch !== "string"
      || !value.store_epoch.trim()
    ) {
      throw new Error("BlockRecord Library effect is invalid");
    }
    return [{
      kind: "library",
      value: {
        value: libraryValue,
        receipt,
        eventSequence: value.event_sequence,
        storeEpoch: value.store_epoch,
      },
    }];
  }
  if (kind === "remove") {
    const lifecycle = value.lifecycle;
    if (lifecycle !== "archived" && lifecycle !== "retired") {
      throw new Error("BlockRecord remove lifecycle is invalid");
    }
    return [{
      kind: "remove",
      value: {
        blockId: requiredString(value.blockId, "remove block id"),
        lifecycle,
        revision: nonNegativeRevision(value.revision, "remove"),
      },
    }];
  }
  const blockId = requiredString(value.blockId, "effect block id");
  if (kind === "placement") {
    return [{
      kind: "placement",
      value: {
        blockId,
        from: parentKey(value.from),
        to: requiredString(parentKey(value.to), "effect destination"),
        rankKey: requiredString(value.rankKey, "effect rank key"),
        revision: nonNegativeRevision(value.revision, "placement"),
      },
    }];
  }
  if (kind === "promotion") {
    const properties = value.properties;
    if (properties !== undefined && !isRecord(properties)) {
      throw new Error("BlockRecord promotion properties are invalid");
    }
    return [
      {
        kind: "record",
        value: {
          blockId,
          kind: "page",
          lifecycle: "active",
          revision: nonNegativeRevision(value.blockRevision, "block"),
          ...(typeof value.libraryId === "string"
            ? { libraryId: requiredString(value.libraryId, "promotion library id") }
            : {}),
          ...(properties ? { properties } : {}),
          ...(typeof value.contentShardId === "string"
            ? { contentShardId: requiredString(value.contentShardId, "promotion content shard") }
            : {}),
        },
      },
      {
        kind: "placement",
        value: {
          blockId,
          from: parentKey(value.from),
          to: requiredString(parentKey(value.to), "promotion destination"),
          rankKey: requiredString(value.rankKey, "promotion rank key"),
          revision: nonNegativeRevision(value.placementRevision, "placement"),
        },
      },
    ];
  }
  if (kind === "record") {
    const lifecycle = value.lifecycle;
    if (
      lifecycle !== "active"
      && lifecycle !== "archived"
      && lifecycle !== "retired"
    ) {
      throw new Error("BlockRecord record lifecycle is invalid");
    }
    const properties = value.properties;
    if (properties !== undefined && !isRecord(properties)) {
      throw new Error("BlockRecord record properties are invalid");
    }
    return [{
      kind: "record",
      value: {
        blockId,
        kind: requiredString(value.kind, "record kind"),
        lifecycle,
        revision: nonNegativeRevision(value.revision, "record"),
        ...(typeof value.libraryId === "string"
          ? { libraryId: requiredString(value.libraryId, "record library id") }
          : {}),
        ...(properties ? { properties } : {}),
        ...(typeof value.contentShardId === "string"
          ? { contentShardId: requiredString(value.contentShardId, "record content shard") }
          : {}),
      },
    }];
  }
  throw new Error(`Unsupported BlockRecord LocalCommit effect kind ${kind}`);
};

export function blockRecordCommitToLocalCommit(
  value: BlockRecordCommittedValue,
): LocalCommitEnvelope {
  return {
    cursor: {
      storeEpoch: requiredString(value.cursor.store_epoch, "store epoch"),
      commitSeq: value.cursor.commit_seq,
    },
    commitId: requiredString(value.commit_id, "commit id"),
    operationId: requiredString(value.operation_id, "operation id"),
    intentHash: requiredString(value.intent_hash, "intent hash"),
    canonicalHash: requiredString(value.canonical_hash, "canonical hash"),
    committedAt: requiredString(value.committed_at, "committed at"),
    actorId: requiredString(value.actor_id, "actor id"),
    sessionId: requiredString(value.session_id, "session id"),
    payloadCompleteness: value.payload_completeness,
    effects: value.effects.flatMap((candidate) => effect(candidate.kind, candidate.value)),
    audience: audience(value.audience),
  };
}
