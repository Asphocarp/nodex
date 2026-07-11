import type {
  DatabaseMutationCommandError,
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "./database-kernel";
import type { MoveCardsInput } from "./types";
import {
  compileDatabaseCardDragMany,
  type DatabaseCardDragManySnapshot,
} from "./database-card-drag-many";

export interface DatabaseCardDragManyRuntimeDependencies {
  readonly readSnapshot: (
    projectId: string,
  ) => Promise<DatabaseCardDragManySnapshot>;
  readonly mutate: (
    projectId: string,
    request: DatabaseMutationRequest,
  ) => Promise<DatabaseMutationCommandResult>;
}

export class DatabaseCardDragManyMutationError extends Error {
  constructor(readonly commandError: DatabaseMutationCommandError) {
    super(commandError.message);
    this.name = "DatabaseCardDragManyMutationError";
  }
}

const refreshRequired = (code: string): boolean =>
  new Set([
    "store_epoch_mismatch",
    "database_not_found",
    "database_not_active",
    "database_schema_conflict",
    "property_not_found",
    "property_conflict",
    "property_value_conflict",
    "membership_conflict",
    "view_not_found",
    "view_conflict",
    "position_conflict",
    "position_anchor_not_found",
    "position_anchor_group_mismatch",
    "position_group_mismatch",
  ]).has(code);

/** Compile once and retain the exact request across one transport retry. */
export const commitDatabaseCardDragMany = async (input: {
  readonly projectId: string;
  readonly clientSessionId?: string;
  readonly operationId: string;
  readonly move: MoveCardsInput;
  readonly dependencies: DatabaseCardDragManyRuntimeDependencies;
}): Promise<boolean> => {
  const snapshot = await input.dependencies.readSnapshot(input.projectId);
  const compiled = compileDatabaseCardDragMany({
    move: input.move,
    snapshot,
  });
  const request: DatabaseMutationRequest = {
    version: 1,
    operationId: input.operationId,
    projectId: input.projectId,
    storeEpoch: snapshot.descriptor.storeEpoch,
    ...(input.clientSessionId
      ? { clientSessionId: input.clientSessionId }
      : {}),
    actor: { kind: "renderer_card_drag_many" },
    operations: compiled.operations,
  };

  let retried = false;
  let result: DatabaseMutationCommandResult;
  try {
    result = await input.dependencies.mutate(input.projectId, request);
  } catch {
    retried = true;
    result = await input.dependencies.mutate(input.projectId, request);
  }
  if (!result.ok && result.error.retryable && !retried) {
    result = await input.dependencies.mutate(input.projectId, request);
  }
  if (result.ok) return true;
  if (refreshRequired(result.error.code)) {
    try {
      await input.dependencies.readSnapshot(input.projectId);
    } catch {
      // Preserve the typed mutation conflict as the actionable failure.
    }
  }
  throw new DatabaseCardDragManyMutationError(result.error);
};
