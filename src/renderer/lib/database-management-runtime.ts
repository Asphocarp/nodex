import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseApplyOperationV2,
  type DatabaseApplyResultV2,
  type DatabaseApplyV2,
  type DatabaseContainerDescriptorV2,
  type DatabaseModuleErrorV2,
  type DatabaseModuleReadRequestV2,
  type DatabaseModuleReadResultV2,
  type DatabaseModuleReadSnapshotV2,
  type DataSourceDescriptorV2,
  type DataSourceRecordV2,
} from "../../shared/database-module-v2";
import { parseDatabaseId } from "../../shared/database-identities";
import { applyDatabaseModule, readDatabaseModule } from "./api";

export interface DatabaseManagementAuthority {
  readonly snapshot: DatabaseModuleReadSnapshotV2;
  readonly databases: readonly DatabaseContainerDescriptorV2[];
  readonly selectedDatabase: DatabaseContainerDescriptorV2;
  readonly selectedDataSource: DataSourceRecordV2;
  readonly source: DataSourceDescriptorV2;
}

export interface DatabaseManagementRuntimeDependencies {
  readonly read: (
    projectId: string,
    request: DatabaseModuleReadRequestV2,
  ) => Promise<DatabaseModuleReadResultV2>;
  readonly apply: (
    projectId: string,
    request: DatabaseApplyV2,
  ) => Promise<DatabaseApplyResultV2>;
}

export class DatabaseManagementReadError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "DatabaseManagementReadError";
  }
}

export class DatabaseManagementMutationError extends Error {
  constructor(readonly commandError: DatabaseModuleErrorV2) {
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
  read: DatabaseModuleReadRequestV2["read"],
  dependencies: DatabaseManagementRuntimeDependencies,
): Promise<DatabaseModuleReadSnapshotV2> => {
  const result = await dependencies.read(projectId, {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
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
  descriptor: DatabaseContainerDescriptorV2,
): DataSourceRecordV2 | null =>
  descriptor.dataSources.find((source) => source.lifecycle === "active") ?? null;

export const readDatabaseManagementAuthority = async (
  projectId: string,
  preferredDatabaseId?: string | null,
  dependencies: DatabaseManagementRuntimeDependencies = defaultDependencies,
): Promise<DatabaseManagementAuthority> => {
  const databaseRead: DatabaseModuleReadRequestV2["read"] = preferredDatabaseId
    ? {
      target: {
        kind: "database",
        databaseId: parseDatabaseId(preferredDatabaseId),
      },
      mode: "database",
    }
    : {
      target: { kind: "project_default" },
      mode: "database",
    };
  const snapshot = await readSnapshot(projectId, databaseRead, dependencies);
  if (snapshot.value.kind !== "database") {
    throw new DatabaseManagementReadError(
      "Database Module did not return the selected Database",
      false,
    );
  }
  const selectedDatabase = snapshot.value.value;
  if (selectedDatabase.database.lifecycle !== "active") {
    throw new DatabaseManagementReadError(
      "Selected Database is not active",
      false,
    );
  }
  const databases = [selectedDatabase];
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
  request: DatabaseApplyV2,
  dependencies: DatabaseManagementRuntimeDependencies,
): Promise<DatabaseApplyResultV2> => {
  let result: DatabaseApplyResultV2;
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
  ) => readonly DatabaseApplyOperationV2[];
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
  const request: DatabaseApplyV2 = {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
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
