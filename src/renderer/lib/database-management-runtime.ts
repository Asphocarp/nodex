import type {
  DatabaseMutationCommandError,
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../../shared/database-kernel";
import type {
  DatabaseReadSnapshot,
  GeneralDatabaseManagement,
  GeneralDatabaseDescriptor,
} from "../../shared/database-query";
import {
  compileDatabaseManagementRequest,
  compileDatabaseMembershipTransferIntent,
  type DatabaseManagementIntent,
} from "./database-management-intents";
import { mutateDatabase, readDatabaseManagement, transferBlocks } from "./api";
import type {
  BlockTransferCommandError,
  BlockTransferCommandResult,
} from "../../shared/block-transfer";
import type { PublicBlockTransferIntent } from "../../shared/block-transfer-transport";

export interface DatabaseManagementAuthority {
  readonly management: DatabaseReadSnapshot<GeneralDatabaseManagement>;
  readonly descriptor: (
    databaseBlockId: string,
  ) => DatabaseReadSnapshot<GeneralDatabaseDescriptor>;
}

export interface DatabaseManagementRuntimeDependencies {
  readonly readManagement: typeof readDatabaseManagement;
  readonly mutate: (
    projectId: string,
    request: DatabaseMutationRequest,
  ) => Promise<DatabaseMutationCommandResult>;
  readonly transfer: (
    projectId: string,
    intent: PublicBlockTransferIntent,
  ) => Promise<BlockTransferCommandResult>;
}

export class DatabaseManagementReadError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "DatabaseManagementReadError";
  }
}

export class DatabaseManagementMutationError extends Error {
  constructor(
    readonly commandError:
      | DatabaseMutationCommandError
      | BlockTransferCommandError,
  ) {
    super(commandError.message);
    this.name = "DatabaseManagementMutationError";
  }
}

const defaultDependencies: DatabaseManagementRuntimeDependencies = {
  readManagement: readDatabaseManagement,
  mutate: mutateDatabase,
  transfer: transferBlocks,
};

const requireManagement = async (
  projectId: string,
  dependencies: DatabaseManagementRuntimeDependencies,
): Promise<DatabaseReadSnapshot<GeneralDatabaseManagement>> => {
  const result = await dependencies.readManagement(projectId);
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
  return snapshot as DatabaseReadSnapshot<GeneralDatabaseManagement>;
};

export const createDatabaseManagementAuthority = (
  management: DatabaseReadSnapshot<GeneralDatabaseManagement>,
): DatabaseManagementAuthority => ({
  management,
  descriptor: (databaseBlockId) => {
    const descriptor = management.value?.catalog.databases.find(
      (candidate) => candidate.database.blockId === databaseBlockId,
    );
    if (!descriptor) {
      throw new DatabaseManagementReadError(
        `Database is not present in the captured catalog: ${databaseBlockId}`,
        false,
      );
    }
    return { ...management, value: descriptor };
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

const applyExactTransfer = async (
  projectId: string,
  intent: PublicBlockTransferIntent,
  dependencies: DatabaseManagementRuntimeDependencies,
): Promise<BlockTransferCommandResult> => {
  let result: BlockTransferCommandResult;
  let retried = false;
  try {
    result = await dependencies.transfer(projectId, intent);
  } catch {
    retried = true;
    result = await dependencies.transfer(projectId, intent);
  }
  if (!result.ok && result.error.retryable && !retried) {
    result = await dependencies.transfer(projectId, intent);
  }
  return result;
};

export const readDatabaseManagementAuthority = async (
  projectId: string,
  dependencies: DatabaseManagementRuntimeDependencies = defaultDependencies,
): Promise<DatabaseReadSnapshot<GeneralDatabaseManagement>> =>
  await requireManagement(projectId, dependencies);

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
}): Promise<DatabaseReadSnapshot<GeneralDatabaseManagement>> => {
  const dependencies = input.dependencies ?? defaultDependencies;
  const management = await requireManagement(input.projectId, dependencies);
  const intent = input.buildIntent(
    createDatabaseManagementAuthority(management),
  );
  const context = {
    operationId: input.operationId,
    projectId: input.projectId,
    storeEpoch: management.storeEpoch,
    ...(input.clientSessionId
      ? { clientSessionId: input.clientSessionId }
      : {}),
    actor: { kind: "renderer_database_management" },
  } as const;
  const result =
    intent.kind === "set_membership"
      ? await applyExactTransfer(
          input.projectId,
          compileDatabaseMembershipTransferIntent({ context, intent }),
          dependencies,
        )
      : await applyExactRequest(
          input.projectId,
          compileDatabaseManagementRequest({ context, intent }),
          dependencies,
        );
  if (!result.ok) throw new DatabaseManagementMutationError(result.error);

  const refreshed = await requireManagement(input.projectId, dependencies);
  if (refreshed.changeLogSeq >= result.value.changeLogSeq) return refreshed;
  throw new DatabaseManagementReadError(
    "Database management refresh is older than the committed mutation",
    true,
  );
};
