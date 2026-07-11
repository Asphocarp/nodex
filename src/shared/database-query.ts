import type {
  DatabaseJsonValue,
  DatabasePropertyValueType,
  GeneralDatabaseViewConfig,
  GeneralDatabaseViewKind,
} from "./database-kernel";

export const DATABASE_QUERY_CONTRACT_VERSION = 1 as const;

export interface GeneralDatabaseCapability {
  readonly blockId: string;
  readonly projectId: string;
  readonly name: string;
  readonly isPrimary: boolean;
  readonly schemaKey: string;
  readonly schemaRevision: number;
  readonly metadataRevision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GeneralDatabasePropertyDefinition {
  readonly id: string;
  readonly databaseBlockId: string;
  readonly key: string;
  readonly name: string;
  readonly valueType: DatabasePropertyValueType;
  readonly config: Readonly<Record<string, DatabaseJsonValue>>;
  readonly rankKey: string;
  readonly lifecycle: "active" | "deleted";
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GeneralDatabaseViewDefinition {
  readonly id: string;
  readonly databaseBlockId: string;
  readonly projectId: string;
  readonly name: string;
  readonly kind: GeneralDatabaseViewKind;
  readonly config: GeneralDatabaseViewConfig;
  readonly isPrimary: boolean;
  readonly revision: number;
  readonly rankKey: string;
  readonly lifecycle: "active" | "deleted";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GeneralDatabaseDescriptor {
  readonly database: GeneralDatabaseCapability;
  readonly properties: readonly GeneralDatabasePropertyDefinition[];
  readonly views: readonly GeneralDatabaseViewDefinition[];
}

export interface CardContentSummary {
  readonly blockId: string;
  readonly projectId: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location:
    | { readonly kind: "space"; readonly rankKey: string | null }
    | { readonly kind: "document"; readonly documentId: string };
  readonly locationRevision: number;
  readonly metadataRevision: number;
  readonly documentId: string;
  readonly documentGeneration: number;
  readonly documentHeadSeq: number;
  readonly documentAuthority: "legacy_shadow" | "ydoc_primary";
  readonly content: null | {
    readonly projectedSeq: number;
    readonly title: string;
    readonly preview: string;
    readonly plainText: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GeneralDatabaseValue {
  readonly propertyId: string;
  readonly valueType: DatabasePropertyValueType;
  readonly value: DatabaseJsonValue;
  readonly revision: number;
}

export interface GeneralDatabaseRow {
  readonly membership: {
    readonly id: string;
    readonly databaseBlockId: string;
    readonly cardBlockId: string;
    readonly revision: number;
    readonly createdAt: string;
  };
  readonly card: CardContentSummary;
  readonly values: Readonly<Record<string, GeneralDatabaseValue>>;
  readonly position: null | {
    readonly groupKey: string | null;
    readonly rankKey: string;
    readonly revision: number;
  };
  readonly effectiveGroupKey: string | null;
}

export interface GeneralDatabaseViewQuery {
  readonly database: GeneralDatabaseCapability;
  readonly view: GeneralDatabaseViewDefinition;
  readonly properties: readonly GeneralDatabasePropertyDefinition[];
  readonly rows: readonly GeneralDatabaseRow[];
}

/**
 * Read responses are deliberately JSON-only: timestamps and property dates
 * remain canonical strings and no SQLite Buffer/BigInt/Date value crosses a
 * renderer or HTTP boundary.
 */
export interface DatabaseReadSnapshot<T> {
  readonly version: typeof DATABASE_QUERY_CONTRACT_VERSION;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly changeLogSeq: number;
  readonly value: T | null;
}

export type DatabaseReadErrorCode =
  | "invalid_database_read_request"
  | "store_not_initialized"
  | "project_not_found"
  | "database_state_corrupt"
  | "unknown";

export interface DatabaseReadCommandError {
  readonly code: DatabaseReadErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type DatabaseReadCommandResult<T> =
  | { readonly ok: true; readonly value: DatabaseReadSnapshot<T> }
  | { readonly ok: false; readonly error: DatabaseReadCommandError };

/**
 * Descriptor and primary View query captured under one authority read. Keeping
 * the two ordinary read snapshots makes existing compilers reusable while the
 * shared epoch/cursor proves that no writer ran between them.
 */
export interface DatabaseViewSnapshot {
  readonly descriptor: DatabaseReadSnapshot<GeneralDatabaseDescriptor>;
  readonly query: DatabaseReadSnapshot<GeneralDatabaseViewQuery>;
}

export type DatabaseViewSnapshotCommandResult =
  | { readonly ok: true; readonly value: DatabaseViewSnapshot }
  | { readonly ok: false; readonly error: DatabaseReadCommandError };

/** @deprecated Use DatabaseViewSnapshot. Kept for the primary drag compiler. */
export type PrimaryDatabaseViewSnapshot = DatabaseViewSnapshot;

export type PrimaryDatabaseViewSnapshotCommandResult =
  DatabaseViewSnapshotCommandResult;
