/**
 * The local commit contract is the boundary between Core durability and
 * delivery adapters.  It is intentionally independent of the old change-log
 * event shape: a commit identifies one completed local mutation and carries
 * the effects needed by consumers to converge without waiting for a replay.
 */

export interface LocalCommitCursor {
  readonly storeEpoch: string;
  readonly commitSeq: number;
}

export interface LocalCommitIdentity extends LocalCommitCursor {
  readonly commitId: string;
}

export type LocalCommitPayloadCompleteness = "sparse" | "rich";

export interface LocalCommitPlacementDelta {
  readonly blockId: string;
  readonly from: string | null;
  readonly to: string;
  readonly rankKey: string;
  readonly revision: number;
}

export interface LocalCommitRecordDelta {
  readonly blockId: string;
  readonly kind: string;
  readonly lifecycle: "active" | "archived" | "retired";
  readonly revision: number;
  readonly libraryId?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly contentShardId?: string;
}

export interface LocalCommitDataSourceDelta {
  readonly dataSourceId: string;
}

export interface LocalCommitPropertyValuesDelta {
  readonly blockId: string;
  readonly dataSourceId: string;
  readonly values: readonly {
    readonly propertyId: string;
    readonly value: unknown;
    readonly revision: number;
  }[];
  readonly revision: number;
}

export interface LocalCommitContentRef {
  readonly blockId: string;
  readonly slot: string;
  readonly shardId: string;
  readonly head: number;
  /** Present for CRDT-update effects; materialized-only commits may omit it. */
  readonly stateHash?: string | null;
  /** A record-backed content commit carries its immediately usable projection. */
  readonly materializedJson?: unknown;
}

export interface LocalCommitViewPositionDelta {
  readonly viewId: string;
  readonly dataSourceId: string;
  readonly blockId: string;
  readonly groupKey: string | null;
  readonly rankKey: string;
  readonly revision: number;
}

export interface LocalCommitViewPositionRemoveDelta {
  readonly viewId: string;
  readonly dataSourceId: string;
  readonly blockId: string;
  readonly revision: number;
}

/**
 * Database domain receipt carried by a BlockRecord LocalCommit. The domain
 * module keeps its detailed receipt shape in the Core contract; this boundary
 * only requires an object so the dispatcher can preserve it without making
 * Database a second publication channel.
 */
export interface LocalCommitDatabaseDelta {
  readonly value: Readonly<Record<string, unknown>>;
  readonly receipt: Readonly<Record<string, unknown>>;
  readonly eventSequence: number;
  readonly storeEpoch: string;
}

/**
 * A legacy domain receipt carried by a BlockRecord LocalCommit while that
 * domain's semantic tables are being folded into the canonical transaction.
 * It is deliberately opaque here; only Core may define the receipt payload.
 */
export interface LocalCommitLibraryDelta {
  readonly value: Readonly<Record<string, unknown>>;
  readonly receipt: Readonly<Record<string, unknown>>;
  readonly eventSequence: number;
  readonly storeEpoch: string;
}

export interface LocalCommitRemoveDelta {
  readonly blockId: string;
  readonly lifecycle: "archived" | "retired";
  readonly revision: number;
}

export interface LocalCommitProjectionDelta {
  readonly kind: "page" | "board" | "library" | "database" | "search";
  readonly scopeId: string;
  readonly upserts: readonly Record<string, unknown>[];
  readonly removes: readonly string[];
}

export type LocalCommitEffect =
  | { readonly kind: "record"; readonly value: LocalCommitRecordDelta }
  | { readonly kind: "placement"; readonly value: LocalCommitPlacementDelta }
  | { readonly kind: "data_source"; readonly value: LocalCommitDataSourceDelta }
  | { readonly kind: "property_values"; readonly value: LocalCommitPropertyValuesDelta }
  | { readonly kind: "content"; readonly value: LocalCommitContentRef }
  | { readonly kind: "database"; readonly value: LocalCommitDatabaseDelta }
  | { readonly kind: "library"; readonly value: LocalCommitLibraryDelta }
  | { readonly kind: "view_position"; readonly value: LocalCommitViewPositionDelta }
  | { readonly kind: "view_position_remove"; readonly value: LocalCommitViewPositionRemoveDelta }
  | { readonly kind: "remove"; readonly value: LocalCommitRemoveDelta }
  | { readonly kind: "projection"; readonly value: LocalCommitProjectionDelta };

export interface LocalCommitAudience {
  /** Core-calculated scope, never inferred by a renderer or initiating window. */
  readonly kind: "library" | "projects";
  readonly projectIds: readonly string[];
}

export interface LocalCommitEnvelope {
  readonly cursor: LocalCommitCursor;
  readonly commitId: string;
  readonly operationId: string;
  readonly intentHash: string;
  readonly canonicalHash: string;
  readonly committedAt: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly payloadCompleteness: LocalCommitPayloadCompleteness;
  readonly effects: readonly LocalCommitEffect[];
  readonly audience: LocalCommitAudience;
}

export const localCommitIdentityKey = (identity: LocalCommitIdentity): string =>
  `${identity.storeEpoch}\u0000${identity.commitSeq}\u0000${identity.commitId}`;

export const localCommitCursorKey = (cursor: LocalCommitCursor): string =>
  `${cursor.storeEpoch}\u0000${cursor.commitSeq}`;

export const compareLocalCommitCursor = (
  left: LocalCommitCursor,
  right: LocalCommitCursor,
): number => {
  if (left.storeEpoch !== right.storeEpoch) return left.storeEpoch.localeCompare(right.storeEpoch);
  return left.commitSeq - right.commitSeq;
};

export const assertLocalCommitEnvelope = (
  envelope: LocalCommitEnvelope,
): void => {
  if (!envelope.cursor.storeEpoch.trim()) throw new Error("LocalCommit Store epoch is empty");
  if (!Number.isSafeInteger(envelope.cursor.commitSeq) || envelope.cursor.commitSeq < 1) {
    throw new Error("LocalCommit sequence is invalid");
  }
  for (const [label, value] of [
    ["commitId", envelope.commitId],
    ["operationId", envelope.operationId],
    ["intentHash", envelope.intentHash],
    ["canonicalHash", envelope.canonicalHash],
    ["committedAt", envelope.committedAt],
    ["actorId", envelope.actorId],
    ["sessionId", envelope.sessionId],
  ] as const) {
    if (!value.trim()) throw new Error(`LocalCommit ${label} is empty`);
  }
}
