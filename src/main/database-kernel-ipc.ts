import type {
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../shared/database-kernel";
import type {
  DatabaseCatalogSnapshotCommandResult,
  DatabaseReadCommandResult,
  DatabaseViewSnapshotCommandResult,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
  PrimaryDatabaseViewSnapshotCommandResult,
} from "../shared/database-query";
import {
  bindDatabaseMutationToProject,
  bindDatabaseReadIdentity,
  databaseMutationFailure,
  databaseReadFailure,
  databaseTransportFailure,
  type TrustedDatabaseMutationIdentity,
} from "../shared/database-transport";

export const DATABASE_MUTATION_IPC_CHANNEL = "databases:mutate" as const;
export const DATABASE_DESCRIPTOR_IPC_CHANNEL =
  "databases:descriptor:get" as const;
export const DATABASE_CATALOG_IPC_CHANNEL = "databases:catalog:get" as const;
export const PRIMARY_DATABASE_DESCRIPTOR_IPC_CHANNEL =
  "databases:primary:get" as const;
export const PRIMARY_DATABASE_VIEW_SNAPSHOT_IPC_CHANNEL =
  "database-views:primary:snapshot" as const;
export const DATABASE_VIEW_SNAPSHOT_IPC_CHANNEL =
  "database-views:snapshot" as const;
export const DATABASE_VIEW_QUERY_IPC_CHANNEL = "database-views:query" as const;

export interface DatabaseKernelIpcDependencies {
  readonly registerHandle: (
    channel:
      | typeof DATABASE_MUTATION_IPC_CHANNEL
      | typeof DATABASE_CATALOG_IPC_CHANNEL
      | typeof DATABASE_DESCRIPTOR_IPC_CHANNEL
      | typeof PRIMARY_DATABASE_DESCRIPTOR_IPC_CHANNEL
      | typeof PRIMARY_DATABASE_VIEW_SNAPSHOT_IPC_CHANNEL
      | typeof DATABASE_VIEW_SNAPSHOT_IPC_CHANNEL
      | typeof DATABASE_VIEW_QUERY_IPC_CHANNEL,
    listener: (
      event: unknown,
      projectId: string,
      value?: unknown,
    ) => Promise<unknown>,
  ) => void;
  readonly resolveTrustedIdentity: (
    event: unknown,
  ) => TrustedDatabaseMutationIdentity | null;
  readonly applyMutation: (
    request: DatabaseMutationRequest,
  ) => Promise<DatabaseMutationCommandResult>;
  readonly readDescriptor: (
    projectId: string,
    databaseBlockId: string,
  ) => Promise<DatabaseReadCommandResult<GeneralDatabaseDescriptor>>;
  readonly readCatalog: (
    projectId: string,
  ) => Promise<DatabaseCatalogSnapshotCommandResult>;
  readonly readPrimaryDescriptor: (
    projectId: string,
  ) => Promise<DatabaseReadCommandResult<GeneralDatabaseDescriptor>>;
  readonly readPrimaryViewSnapshot: (
    projectId: string,
  ) => Promise<PrimaryDatabaseViewSnapshotCommandResult>;
  readonly readViewSnapshot?: (
    projectId: string,
    viewId: string,
  ) => Promise<DatabaseViewSnapshotCommandResult>;
  readonly queryView: (
    projectId: string,
    viewId: string,
  ) => Promise<DatabaseReadCommandResult<GeneralDatabaseViewQuery>>;
}

const untrustedRead = <T>(): DatabaseReadCommandResult<T> => ({
  ok: false,
  error: databaseReadFailure(
    "invalid_database_read_request",
    "Database reads are restricted to a trusted application window",
  ),
});

export const registerDatabaseKernelIpcHandlers = (
  dependencies: DatabaseKernelIpcDependencies,
): void => {
  dependencies.registerHandle(
    DATABASE_MUTATION_IPC_CHANNEL,
    async (event, projectId, rawRequest) => {
      const identity = dependencies.resolveTrustedIdentity(event);
      if (!identity) {
        return {
          ok: false,
          error: databaseMutationFailure(
            "invalid_database_mutation_request",
            "Database mutations are restricted to a trusted application window",
          ),
        } satisfies DatabaseMutationCommandResult;
      }
      const bound = bindDatabaseMutationToProject(
        rawRequest,
        projectId,
        identity,
      );
      if (!bound.ok) return bound;
      try {
        return await dependencies.applyMutation(bound.value);
      } catch (error) {
        return databaseTransportFailure(bound.value, error);
      }
    },
  );

  dependencies.registerHandle(
    DATABASE_CATALOG_IPC_CHANNEL,
    async (event, projectId) => {
      if (!dependencies.resolveTrustedIdentity(event)) {
        return untrustedRead<never>();
      }
      const bound = bindDatabaseReadIdentity(projectId, "catalog");
      if (!bound.ok) return bound;
      try {
        return await dependencies.readCatalog(bound.value.projectId);
      } catch (error) {
        return {
          ok: false,
          error: databaseReadFailure(
            "unknown",
            error instanceof Error
              ? error.message
              : "The Database catalog reader is unavailable",
            true,
          ),
        } satisfies DatabaseCatalogSnapshotCommandResult;
      }
    },
  );

  dependencies.registerHandle(
    PRIMARY_DATABASE_DESCRIPTOR_IPC_CHANNEL,
    async (event, projectId) => {
      if (!dependencies.resolveTrustedIdentity(event)) {
        return untrustedRead<GeneralDatabaseDescriptor>();
      }
      const bound = bindDatabaseReadIdentity(projectId, "primary");
      if (!bound.ok) return bound;
      try {
        return await dependencies.readPrimaryDescriptor(bound.value.projectId);
      } catch (error) {
        return {
          ok: false,
          error: databaseReadFailure(
            "unknown",
            error instanceof Error
              ? error.message
              : "The primary Database reader is unavailable",
            true,
          ),
        } satisfies DatabaseReadCommandResult<GeneralDatabaseDescriptor>;
      }
    },
  );

  dependencies.registerHandle(
    PRIMARY_DATABASE_VIEW_SNAPSHOT_IPC_CHANNEL,
    async (event, projectId) => {
      if (!dependencies.resolveTrustedIdentity(event)) {
        return untrustedRead<never>();
      }
      const bound = bindDatabaseReadIdentity(projectId, "primary-view");
      if (!bound.ok) return bound;
      try {
        return await dependencies.readPrimaryViewSnapshot(
          bound.value.projectId,
        );
      } catch (error) {
        return {
          ok: false,
          error: databaseReadFailure(
            "unknown",
            error instanceof Error
              ? error.message
              : "The primary Database View snapshot is unavailable",
            true,
          ),
        } satisfies PrimaryDatabaseViewSnapshotCommandResult;
      }
    },
  );

  dependencies.registerHandle(
    DATABASE_VIEW_SNAPSHOT_IPC_CHANNEL,
    async (event, projectId, viewId) => {
      if (!dependencies.resolveTrustedIdentity(event)) {
        return untrustedRead<never>();
      }
      const bound = bindDatabaseReadIdentity(projectId, viewId);
      if (!bound.ok) return bound;
      if (!dependencies.readViewSnapshot) {
        return {
          ok: false,
          error: databaseReadFailure(
            "unknown",
            "The Database View snapshot reader is unavailable",
            true,
          ),
        } satisfies DatabaseViewSnapshotCommandResult;
      }
      try {
        return await dependencies.readViewSnapshot(
          bound.value.projectId,
          bound.value.resourceId,
        );
      } catch {
        return {
          ok: false,
          error: databaseReadFailure(
            "unknown",
            "The Database View snapshot is unavailable",
            true,
          ),
        } satisfies DatabaseViewSnapshotCommandResult;
      }
    },
  );

  dependencies.registerHandle(
    DATABASE_DESCRIPTOR_IPC_CHANNEL,
    async (event, projectId, databaseBlockId) => {
      if (!dependencies.resolveTrustedIdentity(event)) {
        return untrustedRead<GeneralDatabaseDescriptor>();
      }
      const bound = bindDatabaseReadIdentity(projectId, databaseBlockId);
      if (!bound.ok) return bound;
      try {
        return await dependencies.readDescriptor(
          bound.value.projectId,
          bound.value.resourceId,
        );
      } catch (error) {
        return {
          ok: false,
          error: databaseReadFailure(
            "unknown",
            error instanceof Error
              ? error.message
              : "The Database reader is unavailable",
            true,
          ),
        } satisfies DatabaseReadCommandResult<GeneralDatabaseDescriptor>;
      }
    },
  );

  dependencies.registerHandle(
    DATABASE_VIEW_QUERY_IPC_CHANNEL,
    async (event, projectId, viewId) => {
      if (!dependencies.resolveTrustedIdentity(event)) {
        return untrustedRead<GeneralDatabaseViewQuery>();
      }
      const bound = bindDatabaseReadIdentity(projectId, viewId);
      if (!bound.ok) return bound;
      try {
        return await dependencies.queryView(
          bound.value.projectId,
          bound.value.resourceId,
        );
      } catch (error) {
        return {
          ok: false,
          error: databaseReadFailure(
            "unknown",
            error instanceof Error
              ? error.message
              : "The Database reader is unavailable",
            true,
          ),
        } satisfies DatabaseReadCommandResult<GeneralDatabaseViewQuery>;
      }
    },
  );
};
