export const DATABASE_CHANGE_EVENT_VERSION = 2 as const;

export type DatabaseChangeSourceKind =
  | "database_module"
  | "database_mutation"
  | "block_transfer"
  | "page_lifecycle"
  | "nodex_agent_create"
  | "nodex_agent_transfer"
  | "nodex_agent_database_edit";

/**
 * Resource-scoped invalidation after one durable mutation touches Library
 * Database authority. Project remains the subscription/actor context; the
 * affected resource coordinates are canonical Library identities.
 */
export interface DatabaseChangeEvent {
  readonly version: typeof DATABASE_CHANGE_EVENT_VERSION;
  readonly projectId: string;
  readonly libraryId?: string;
  readonly storeEpoch: string;
  readonly operationId: string;
  readonly sourceKind: DatabaseChangeSourceKind;
  readonly affectedDatabaseIds: readonly string[];
  readonly affectedDataSourceIds?: readonly string[];
  readonly affectedPageIds?: readonly string[];
  readonly affectedViewIds?: readonly string[];
  readonly commitSeq: number;
}
