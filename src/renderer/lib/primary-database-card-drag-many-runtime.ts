import type { MoveCardsInput } from "../../shared/types";
import { commitDatabaseCardDragMany } from "../../shared/database-card-drag-many-runtime";
import type {
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../../shared/database-kernel";
import type {
  PrimaryDatabaseViewSnapshot,
  PrimaryDatabaseViewSnapshotCommandResult,
} from "../../shared/database-query";
import { mutateDatabase, readPrimaryDatabaseViewSnapshot } from "./api";

export interface PrimaryDatabaseCardDragManyRuntimeDependencies {
  readonly readSnapshot: (
    projectId: string,
  ) => Promise<PrimaryDatabaseViewSnapshotCommandResult>;
  readonly mutate: (
    projectId: string,
    request: DatabaseMutationRequest,
  ) => Promise<DatabaseMutationCommandResult>;
}

const defaultDependencies: PrimaryDatabaseCardDragManyRuntimeDependencies = {
  readSnapshot: readPrimaryDatabaseViewSnapshot,
  mutate: mutateDatabase,
};

const readSnapshotValue = (
  result: PrimaryDatabaseViewSnapshotCommandResult,
): PrimaryDatabaseViewSnapshot => {
  if (result.ok) return result.value;
  throw new Error(
    `Primary Database View snapshot unavailable: ${result.error.message}`,
  );
};

/**
 * Commit one visual multi-Card drag through the same Database authority used by
 * single-Card drag. The shared runtime compiles one logical snapshot and keeps
 * the resulting request object intact across its one allowed transport retry.
 */
export const commitPrimaryDatabaseCardDragMany = async (input: {
  readonly projectId: string;
  readonly clientSessionId?: string;
  readonly operationId: string;
  readonly move: MoveCardsInput;
  readonly dependencies?: PrimaryDatabaseCardDragManyRuntimeDependencies;
}): Promise<boolean> => {
  const dependencies = input.dependencies ?? defaultDependencies;
  return await commitDatabaseCardDragMany({
    projectId: input.projectId,
    clientSessionId: input.clientSessionId,
    operationId: input.operationId,
    move: input.move,
    dependencies: {
      readSnapshot: async (projectId) =>
        readSnapshotValue(await dependencies.readSnapshot(projectId)),
      mutate: dependencies.mutate,
    },
  });
};
