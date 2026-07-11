import type {
  DatabaseMutationCommandError,
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../../shared/database-kernel";
import type {
  DatabaseReadSnapshot,
  GeneralDatabaseCatalog,
  GeneralDatabaseDescriptor,
} from "../../shared/database-query";
import {
  compileDatabaseManagementRequest,
  type DatabaseManagementIntent,
} from "./database-management-intents";
import { mutateDatabase, readDatabaseCatalog } from "./api";

export interface DatabaseManagementAuthority {
  readonly catalog: DatabaseReadSnapshot<GeneralDatabaseCatalog>;
  readonly descriptor: (
    databaseBlockId: string,
  ) => DatabaseReadSnapshot<GeneralDatabaseDescriptor>;
}

export interface DatabaseManagementRuntimeDependencies {
  readonly readCatalog: typeof readDatabaseCatalog;
  readonly mutate: (
    projectId: string,
    request: DatabaseMutationRequest,
  ) => Promise<DatabaseMutationCommandResult>;
}

export class DatabaseManagementReadError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "DatabaseManagementReadError";
  }
}

export class DatabaseManagementMutationError extends Error {
  constructor(readonly commandError: DatabaseMutationCommandError) {
    super(commandError.message);
    this.name = "DatabaseManagementMutationError";
  }
}

const defaultDependencies: DatabaseManagementRuntimeDependencies = {
  readCatalog: readDatabaseCatalog,
  mutate: mutateDatabase,
};

const requireCatalog = async (
  projectId: string,
  dependencies: DatabaseManagementRuntimeDependencies,
): Promise<DatabaseReadSnapshot<GeneralDatabaseCatalog>> => {
  const result = await dependencies.readCatalog(projectId);
  if (!result.ok) {
    throw new DatabaseManagementReadError(
      result.error.message,
      result.error.retryable,
    );
  }
  const snapshot = result.value;
  if (snapshot.projectId !== projectId || !snapshot.value) {
    throw new DatabaseManagementReadError(
      "Database catalog does not match the requested Project",
      false,
    );
  }
  return snapshot as DatabaseReadSnapshot<GeneralDatabaseCatalog>;
};

export const createDatabaseManagementAuthority = (
  catalog: DatabaseReadSnapshot<GeneralDatabaseCatalog>,
): DatabaseManagementAuthority => ({
  catalog,
  descriptor: (databaseBlockId) => {
    const descriptor = catalog.value?.databases.find(
      (candidate) => candidate.database.blockId === databaseBlockId,
    );
    if (!descriptor) {
      throw new DatabaseManagementReadError(
        `Database is not present in the captured catalog: ${databaseBlockId}`,
        false,
      );
    }
    return { ...catalog, value: descriptor };
  },
});

const applyExactRequest = async (
  projectId: string,
  request: DatabaseMutationRequest,
  dependencies: DatabaseManagementRuntimeDependencies,
): Promise<DatabaseMutationCommandResult> => {
  let result: DatabaseMutationCommandResult;
  let retried = false;
  try {
    result = await dependencies.mutate(projectId, request);
  } catch {
    retried = true;
    result = await dependencies.mutate(projectId, request);
  }
  if (!result.ok && result.error.retryable && !retried) {
    result = await dependencies.mutate(projectId, request);
  }
  return result;
};

export const readDatabaseManagementCatalog = async (
  projectId: string,
  dependencies: DatabaseManagementRuntimeDependencies = defaultDependencies,
): Promise<DatabaseReadSnapshot<GeneralDatabaseCatalog>> =>
  await requireCatalog(projectId, dependencies);

/**
 * Read one complete Project catalog, compile a single intent exactly once,
 * and retain the resulting request object for its one allowed transport retry.
 */
export const commitDatabaseManagementIntent = async (input: {
  readonly projectId: string;
  readonly operationId: string;
  readonly clientSessionId?: string;
  readonly buildIntent: (
    authority: DatabaseManagementAuthority,
  ) => DatabaseManagementIntent;
  readonly dependencies?: DatabaseManagementRuntimeDependencies;
}): Promise<DatabaseReadSnapshot<GeneralDatabaseCatalog>> => {
  const dependencies = input.dependencies ?? defaultDependencies;
  const catalog = await requireCatalog(input.projectId, dependencies);
  const request = compileDatabaseManagementRequest({
    context: {
      operationId: input.operationId,
      projectId: input.projectId,
      storeEpoch: catalog.storeEpoch,
      ...(input.clientSessionId
        ? { clientSessionId: input.clientSessionId }
        : {}),
      actor: { kind: "renderer_database_management" },
    },
    intent: input.buildIntent(createDatabaseManagementAuthority(catalog)),
  });
  const result = await applyExactRequest(
    input.projectId,
    request,
    dependencies,
  );
  if (!result.ok) throw new DatabaseManagementMutationError(result.error);

  const refreshed = await requireCatalog(input.projectId, dependencies);
  if (refreshed.changeLogSeq >= result.value.changeLogSeq) return refreshed;
  throw new DatabaseManagementReadError(
    "Database catalog refresh is older than the committed mutation",
    true,
  );
};
