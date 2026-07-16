import {
  DATABASE_MODULE_CONTRACT_VERSION,
  type DatabaseApply,
  type DatabaseApplyOperation,
  type DatabaseApplyResult,
  type DatabaseContainerDescriptor,
  type DatabaseModuleError,
  type DatabaseModuleReadRequest,
  type DatabaseModuleReadResult,
  type DatabaseModuleReadSnapshot,
  type DataSourceDescriptor,
  type DataSourceRecord,
} from "../../shared/database-module";
import { applyDatabaseModule, readDatabaseModule } from "./api";

export interface DatabaseManagementAuthority {
  readonly snapshot: DatabaseModuleReadSnapshot;
  readonly databases: readonly DatabaseContainerDescriptor[];
  readonly selectedDatabase: DatabaseContainerDescriptor;
  readonly selectedDataSource: DataSourceRecord;
  readonly source: DataSourceDescriptor;
}

export interface DatabaseManagementRuntimeDependencies {
  readonly read: (
    projectId: string,
    request: DatabaseModuleReadRequest,
  ) => Promise<DatabaseModuleReadResult>;
  readonly apply: (
    projectId: string,
    request: DatabaseApply,
  ) => Promise<DatabaseApplyResult>;
}

export class DatabaseManagementReadError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "DatabaseManagementReadError";
  }
}

export class DatabaseManagementMutationError extends Error {
  constructor(readonly commandError: DatabaseModuleError) {
    super(commandError.message);
    this.name = "DatabaseManagementMutationError";
  }
}

const defaultDependencies: DatabaseManagementRuntimeDependencies = {
  read: readDatabaseModule,
  apply: applyDatabaseModule,
};

const readSnapshot = async (
  projectId: string,
  read: DatabaseModuleReadRequest["read"],
  dependencies: DatabaseManagementRuntimeDependencies,
): Promise<DatabaseModuleReadSnapshot> => {
  const result = await dependencies.read(projectId, {
    version: DATABASE_MODULE_CONTRACT_VERSION,
    projectId,
    read,
  });
  if (!result.ok) {
    throw new DatabaseManagementReadError(
      result.error.message,
      result.error.retryable,
    );
  }
  if (result.value.projectId === projectId) return result.value;
  throw new DatabaseManagementReadError(
    "Database catalog does not match the requested Project",
    false,
  );
};

const activeSource = (
  descriptor: DatabaseContainerDescriptor,
): DataSourceRecord | null =>
  descriptor.dataSources.find((source) => source.lifecycle === "active") ?? null;

export const readDatabaseManagementAuthority = async (
  projectId: string,
  preferredDatabaseId?: string | null,
  dependencies: DatabaseManagementRuntimeDependencies = defaultDependencies,
): Promise<DatabaseManagementAuthority> => {
  const snapshot = await readSnapshot(projectId, {
    target: { kind: "project_default" },
    mode: "catalog",
  }, dependencies);
  if (snapshot.value.kind !== "catalog") {
    throw new DatabaseManagementReadError(
      "Database Module did not return a catalog",
      false,
    );
  }
  const databases = snapshot.value.databases.filter(
    (descriptor) => descriptor.database.lifecycle === "active",
  );
  const preferred = preferredDatabaseId
    ? databases.find(
        (descriptor) => descriptor.database.databaseId === preferredDatabaseId,
      )
    : null;
  const selectedDatabase = preferred ?? databases[0];
  if (!selectedDatabase) {
    throw new DatabaseManagementReadError(
      "Project has no authorized active Database",
      false,
    );
  }
  const selectedDataSource = activeSource(selectedDatabase);
  if (!selectedDataSource) {
    throw new DatabaseManagementReadError(
      `Database ${selectedDatabase.database.databaseId} has no active Data Source`,
      false,
    );
  }
  const sourceSnapshot = await readSnapshot(projectId, {
    target: {
      kind: "data_source",
      dataSourceId: selectedDataSource.dataSourceId,
    },
    mode: "data_source",
  }, dependencies);
  if (
    sourceSnapshot.storeEpoch !== snapshot.storeEpoch
    || sourceSnapshot.value.kind !== "data_source"
    || sourceSnapshot.value.value.dataSource.dataSourceId
      !== selectedDataSource.dataSourceId
  ) {
    throw new DatabaseManagementReadError(
      "Database catalog and Data Source do not share one authority cursor",
      true,
    );
  }
  return {
    snapshot: sourceSnapshot,
    databases,
    selectedDatabase,
    selectedDataSource,
    source: sourceSnapshot.value.value,
  };
};

const applyExactRequest = async (
  projectId: string,
  request: DatabaseApply,
  dependencies: DatabaseManagementRuntimeDependencies,
): Promise<DatabaseApplyResult> => {
  let result: DatabaseApplyResult;
  let retried = false;
  try {
    result = await dependencies.apply(projectId, request);
  } catch {
    retried = true;
    result = await dependencies.apply(projectId, request);
  }
  if (!result.ok && result.error.retryable && !retried) {
    result = await dependencies.apply(projectId, request);
  }
  return result;
};

export const commitDatabaseManagementOperations = async (input: {
  readonly projectId: string;
  readonly preferredDatabaseId?: string | null;
  readonly operationId: string;
  readonly clientSessionId?: string;
  readonly buildOperations: (
    authority: DatabaseManagementAuthority,
  ) => readonly DatabaseApplyOperation[];
  readonly dependencies?: DatabaseManagementRuntimeDependencies;
}): Promise<DatabaseManagementAuthority> => {
  const dependencies = input.dependencies ?? defaultDependencies;
  const authority = await readDatabaseManagementAuthority(
    input.projectId,
    input.preferredDatabaseId,
    dependencies,
  );
  const operations = input.buildOperations(authority);
  if (operations.length === 0) return authority;
  const request: DatabaseApply = {
    version: DATABASE_MODULE_CONTRACT_VERSION,
    operationId: input.operationId,
    projectId: input.projectId,
    storeEpoch: authority.snapshot.storeEpoch,
    actor: {
      kind: "renderer_database_management",
      ...(input.clientSessionId
        ? { clientSessionId: input.clientSessionId }
        : {}),
    },
    operations,
  };
  const result = await applyExactRequest(
    input.projectId,
    request,
    dependencies,
  );
  if (!result.ok) throw new DatabaseManagementMutationError(result.error);
  const refreshed = await readDatabaseManagementAuthority(
    input.projectId,
    authority.selectedDatabase.database.databaseId,
    dependencies,
  );
  if (refreshed.snapshot.changeLogSeq >= result.value.changeLogSeq) {
    return refreshed;
  }
  throw new DatabaseManagementReadError(
    "Database management refresh is older than the committed mutation",
    true,
  );
};
