export const DATABASE_CHANGE_EVENT_VERSION = 1 as const;

export type DatabaseChangeSourceKind =
  | "database_mutation"
  | "block_transfer"
  | "card_lifecycle"
  | "card_project_transfer"
  | "nodex_agent_create"
  | "nodex_agent_transfer"
  | "nodex_agent_database_edit";

/**
 * Project-scoped invalidation after one durable mutation touches Database
 * authority. Consumers refetch descriptors/queries instead of replaying
 * relational schema, membership, value, or View deltas in renderer memory.
 */
export interface DatabaseChangeEvent {
  readonly version: typeof DATABASE_CHANGE_EVENT_VERSION;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly operationId: string;
  readonly sourceKind: DatabaseChangeSourceKind;
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly changeLogSeq: number;
}
