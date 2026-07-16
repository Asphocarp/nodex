import {
  DATABASE_MODULE_CONTRACT_VERSION,
  type DatabaseApply,
  type DatabaseApplyResult,
  type DatabaseModuleError,
  type DatabaseModuleReadRequest,
  type DatabaseModuleReadResult,
  type DatabaseModuleReadSnapshot,
} from "../../shared/database-module";
import {
  compileDatabasePageDrag,
  compileDatabasePagesDrag,
} from "../../shared/database-page-drag";
import type { MovePageInput, MovePagesInput } from "../../shared/types";
import { applyDatabaseModule, readDatabaseModule } from "./api";

export interface DatabasePageDragRuntimeDependencies {
  readonly read: (
    projectId: string,
    request: DatabaseModuleReadRequest,
  ) => Promise<DatabaseModuleReadResult>;
  readonly apply: (
    projectId: string,
    request: DatabaseApply,
  ) => Promise<DatabaseApplyResult>;
}

export class DatabasePageDragMutationError extends Error {
  constructor(readonly commandError: DatabaseModuleError) {
    super(commandError.message);
    this.name = "DatabasePageDragMutationError";
  }
}

const defaultDependencies: DatabasePageDragRuntimeDependencies = {
  read: readDatabaseModule,
  apply: applyDatabaseModule,
};

const readCurrentQuery = async (
  projectId: string,
  dependencies: DatabasePageDragRuntimeDependencies,
): Promise<DatabaseModuleReadSnapshot> => {
  const result = await dependencies.read(projectId, {
    version: DATABASE_MODULE_CONTRACT_VERSION,
    projectId,
    read: { target: { kind: "project_default" }, mode: "query" },
  });
  if (!result.ok) {
    throw new DatabasePageDragMutationError(result.error);
  }
  if (result.value.value.kind !== "query") {
    throw new Error("Project-default Database query returned another read mode");
  }
  return result.value;
};

const refreshRequired = (code: DatabaseModuleError["code"]): boolean =>
  code === "revision_conflict"
  || code === "resource_not_found"
  || code === "authorization_denied"
  || code === "store_not_initialized";

const commitCompiledDrag = async (input: {
  readonly projectId: string;
  readonly clientSessionId?: string;
  readonly operationId: string;
  readonly compile: (
    snapshot: DatabaseModuleReadSnapshot,
  ) => DatabaseApply["operations"];
  readonly dependencies: DatabasePageDragRuntimeDependencies;
}): Promise<boolean> => {
  const snapshot = await readCurrentQuery(input.projectId, input.dependencies);
  const request: DatabaseApply = {
    version: DATABASE_MODULE_CONTRACT_VERSION,
    operationId: input.operationId,
    projectId: input.projectId,
    storeEpoch: snapshot.storeEpoch,
    actor: {
      kind: "renderer_page_drag",
      ...(input.clientSessionId
        ? { clientSessionId: input.clientSessionId }
        : {}),
    },
    operations: input.compile(snapshot),
  };

  let retried = false;
  let result: DatabaseApplyResult;
  try {
    result = await input.dependencies.apply(input.projectId, request);
  } catch {
    retried = true;
    result = await input.dependencies.apply(input.projectId, request);
  }
  if (!result.ok && result.error.retryable && !retried) {
    result = await input.dependencies.apply(input.projectId, request);
  }
  if (result.ok) return true;
  if (refreshRequired(result.error.code)) {
    try {
      await readCurrentQuery(input.projectId, input.dependencies);
    } catch {
      // Preserve the typed apply failure as the actionable error.
    }
  }
  throw new DatabasePageDragMutationError(result.error);
};

export const commitDatabasePageDrag = async (input: {
  readonly projectId: string;
  readonly clientSessionId?: string;
  readonly operationId: string;
  readonly move: MovePageInput;
  readonly dependencies?: DatabasePageDragRuntimeDependencies;
}): Promise<boolean> =>
  await commitCompiledDrag({
    projectId: input.projectId,
    ...(input.clientSessionId
      ? { clientSessionId: input.clientSessionId }
      : {}),
    operationId: input.operationId,
    compile: (snapshot) =>
      compileDatabasePageDrag({ move: input.move, snapshot }).operations,
    dependencies: input.dependencies ?? defaultDependencies,
  });

export const commitDatabasePagesDrag = async (input: {
  readonly projectId: string;
  readonly clientSessionId?: string;
  readonly operationId: string;
  readonly move: MovePagesInput;
  readonly dependencies?: DatabasePageDragRuntimeDependencies;
}): Promise<boolean> =>
  await commitCompiledDrag({
    projectId: input.projectId,
    ...(input.clientSessionId
      ? { clientSessionId: input.clientSessionId }
      : {}),
    operationId: input.operationId,
    compile: (snapshot) =>
      compileDatabasePagesDrag({ move: input.move, snapshot }).operations,
    dependencies: input.dependencies ?? defaultDependencies,
  });
