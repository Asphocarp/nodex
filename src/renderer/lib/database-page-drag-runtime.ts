import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseApplyResultV2,
  type DatabaseApplyV2,
  type DatabaseModuleErrorV2,
  type DatabaseModuleReadSnapshotV2,
} from "../../shared/database-module-v2";
import {
  compileDatabasePageDrag,
  compileDatabasePagesDrag,
} from "../../shared/database-page-drag";
import type { MovePageInput, MovePagesInput } from "../../shared/types";
import { applyDatabaseModule } from "./api";
import type { DatabaseViewRenderModel } from "./database-view-render-model";

export interface DatabasePageDragRuntimeDependencies {
  readonly apply: (
    projectId: string,
    request: DatabaseApplyV2,
  ) => Promise<DatabaseApplyResultV2>;
}

export class DatabasePageDragMutationError extends Error {
  constructor(readonly commandError: DatabaseModuleErrorV2) {
    super(commandError.message);
    this.name = "DatabasePageDragMutationError";
  }
}

const defaultDependencies: DatabasePageDragRuntimeDependencies = {
  apply: applyDatabaseModule,
};

export const databaseViewRenderModelToDragSnapshot = (
  view: DatabaseViewRenderModel,
): DatabaseModuleReadSnapshotV2 => {
  if (view.accessContext.kind !== "project") {
    throw new Error("Project Page drag requires Project Database authority");
  }
  return {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    projectId: view.accessContext.projectId,
    libraryId: view.libraryId,
    storeEpoch: view.storeEpoch,
    changeLogSeq: view.changeLogSeq,
    value: { kind: "query", value: view.query },
  };
};

const commitCompiledDrag = async (input: {
  readonly projectId: string;
  readonly clientSessionId?: string;
  readonly operationId: string;
  readonly compile: (
    snapshot: DatabaseModuleReadSnapshotV2,
  ) => DatabaseApplyV2["operations"];
  readonly snapshot: DatabaseModuleReadSnapshotV2;
  readonly dependencies: DatabasePageDragRuntimeDependencies;
}): Promise<boolean> => {
  const request: DatabaseApplyV2 = {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    operationId: input.operationId,
    projectId: input.projectId,
    storeEpoch: input.snapshot.storeEpoch,
    actor: {
      kind: "renderer_page_drag",
      ...(input.clientSessionId
        ? { clientSessionId: input.clientSessionId }
        : {}),
    },
    operations: input.compile(input.snapshot),
  };

  let retried = false;
  let result: DatabaseApplyResultV2;
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
  throw new DatabasePageDragMutationError(result.error);
};

export const commitDatabasePageDrag = async (input: {
  readonly projectId: string;
  readonly clientSessionId?: string;
  readonly operationId: string;
  readonly move: MovePageInput;
  readonly snapshot: DatabaseModuleReadSnapshotV2;
  readonly dependencies?: DatabasePageDragRuntimeDependencies;
}): Promise<boolean> =>
  await commitCompiledDrag({
    projectId: input.projectId,
    ...(input.clientSessionId
      ? { clientSessionId: input.clientSessionId }
      : {}),
    operationId: input.operationId,
    snapshot: input.snapshot,
    compile: (snapshot) =>
      compileDatabasePageDrag({ move: input.move, snapshot }).operations,
    dependencies: input.dependencies ?? defaultDependencies,
  });

export const commitDatabasePagesDrag = async (input: {
  readonly projectId: string;
  readonly clientSessionId?: string;
  readonly operationId: string;
  readonly move: MovePagesInput;
  readonly snapshot: DatabaseModuleReadSnapshotV2;
  readonly dependencies?: DatabasePageDragRuntimeDependencies;
}): Promise<boolean> =>
  await commitCompiledDrag({
    projectId: input.projectId,
    ...(input.clientSessionId
      ? { clientSessionId: input.clientSessionId }
      : {}),
    operationId: input.operationId,
    snapshot: input.snapshot,
    compile: (snapshot) =>
      compileDatabasePagesDrag({ move: input.move, snapshot }).operations,
    dependencies: input.dependencies ?? defaultDependencies,
  });
