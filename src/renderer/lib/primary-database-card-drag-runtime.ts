import type {
  DatabaseMutationCommandError,
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../../shared/database-kernel";
import type {
  DatabaseReadCommandResult,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
} from "../../shared/database-query";
import type { MoveCardInput } from "../../shared/types";
import {
  mutateDatabase,
  queryDatabaseView,
  readPrimaryDatabaseDescriptor,
} from "./api";
import {
  compilePrimaryDatabaseCardDrag,
  isRefreshRequiredDatabaseMutationError,
  type PrimaryDatabaseCardDragSnapshot,
} from "./primary-database-card-drag";

export interface PrimaryDatabaseCardDragRuntimeDependencies {
  readonly readPrimaryDescriptor: (
    projectId: string,
  ) => Promise<DatabaseReadCommandResult<GeneralDatabaseDescriptor>>;
  readonly queryView: (
    projectId: string,
    viewId: string,
  ) => Promise<DatabaseReadCommandResult<GeneralDatabaseViewQuery>>;
  readonly mutate: (
    projectId: string,
    request: DatabaseMutationRequest,
  ) => Promise<DatabaseMutationCommandResult>;
}

export class PrimaryDatabaseCardDragMutationError extends Error {
  constructor(readonly commandError: DatabaseMutationCommandError) {
    super(commandError.message);
    this.name = "PrimaryDatabaseCardDragMutationError";
  }
}

const defaultDependencies: PrimaryDatabaseCardDragRuntimeDependencies = {
  readPrimaryDescriptor: readPrimaryDatabaseDescriptor,
  queryView: queryDatabaseView,
  mutate: mutateDatabase,
};

const readSnapshotValue = <T>(
  result: DatabaseReadCommandResult<T>,
  label: string,
) => {
  if (!result.ok) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  if (!result.value.value) {
    throw new Error(`${label}: authority not found`);
  }
  return result.value;
};

export const readCurrentPrimaryDatabaseCardDragSnapshot = async (
  projectId: string,
  dependencies: PrimaryDatabaseCardDragRuntimeDependencies =
    defaultDependencies,
): Promise<PrimaryDatabaseCardDragSnapshot> => {
  const descriptor = readSnapshotValue(
    await dependencies.readPrimaryDescriptor(projectId),
    "Primary Database descriptor unavailable",
  );
  const primaryView = descriptor.value?.views.find(
    (view) =>
      view.lifecycle === "active" &&
      view.isPrimary &&
      view.kind === "kanban",
  );
  if (!primaryView) {
    throw new Error("Primary Database has no active primary Kanban View");
  }
  const query = readSnapshotValue(
    await dependencies.queryView(projectId, primaryView.id),
    "Primary Database View unavailable",
  );
  return { descriptor, query };
};

/** One caller-retained operation ID maps to one atomic Database receipt. */
export const commitPrimaryDatabaseCardDrag = async (input: {
  readonly projectId: string;
  readonly clientSessionId?: string;
  readonly operationId: string;
  readonly move: MoveCardInput;
  readonly dependencies?: PrimaryDatabaseCardDragRuntimeDependencies;
}): Promise<boolean> => {
  const dependencies = input.dependencies ?? defaultDependencies;
  const snapshot = await readCurrentPrimaryDatabaseCardDragSnapshot(
    input.projectId,
    dependencies,
  );
  const compiled = compilePrimaryDatabaseCardDrag({
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
    actor: { kind: "renderer_card_drag" },
    operations: compiled.operations,
  };
  let result: DatabaseMutationCommandResult;
  let retried = false;
  try {
    result = await dependencies.mutate(input.projectId, request);
  } catch {
    retried = true;
    result = await dependencies.mutate(input.projectId, request);
  }
  if (!result.ok && result.error.retryable && !retried) {
    result = await dependencies.mutate(input.projectId, request);
  }
  if (result.ok) return true;
  if (isRefreshRequiredDatabaseMutationError(result.error.code)) {
    try {
      await readCurrentPrimaryDatabaseCardDragSnapshot(
        input.projectId,
        dependencies,
      );
    } catch {
      // Preserve the typed mutation conflict as the actionable failure.
    }
  }
  throw new PrimaryDatabaseCardDragMutationError(result.error);
};
