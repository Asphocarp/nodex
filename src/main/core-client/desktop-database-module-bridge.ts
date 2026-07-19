import type {
  DatabaseApplyResultV2,
  DatabaseApplyV2,
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
} from "../../shared/database-module-v2";
import {
  DATABASE_CHANGE_EVENT_VERSION,
  type DatabaseChangeEvent,
} from "../../shared/database-events";
import type {
  DesktopDataAuthorityRuntime,
  RustDataAuthorityRuntime,
} from "./desktop-data-authority";
import type { CoreEventEnvelope } from "./types";
import {
  createCoreDatabaseModuleAdapter,
  type CoreDatabaseModuleAdapter,
} from "./database-module-adapter";

export interface DesktopDatabaseModuleBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly typescript: {
    read(
      request: DatabaseModuleReadRequestV2,
    ): Promise<DatabaseModuleReadResultV2>;
    apply(request: DatabaseApplyV2): Promise<DatabaseApplyResultV2>;
  };
}

export interface DesktopDatabaseModuleBridge {
  read(
    request: DatabaseModuleReadRequestV2,
  ): Promise<DatabaseModuleReadResultV2>;
  apply(request: DatabaseApplyV2): Promise<DatabaseApplyResultV2>;
}

export const createDesktopDatabaseModuleBridge = (
  input: DesktopDatabaseModuleBridgeInput,
): DesktopDatabaseModuleBridge => {
  const coreAdapters = new Map<string, CoreDatabaseModuleAdapter>();
  const coreAdapterFor = (
    runtime: RustDataAuthorityRuntime,
    projectId: string,
  ): CoreDatabaseModuleAdapter => {
    const existing = coreAdapters.get(projectId);
    if (existing) return existing;
    const adapter = createCoreDatabaseModuleAdapter({
      client: runtime.clientForProject(projectId),
      projectId,
      libraryId: runtime.rootClient.handshake.library_id,
      storeEpoch: runtime.rootClient.handshake.store_epoch,
    });
    coreAdapters.set(projectId, adapter);
    return adapter;
  };

  return {
    read: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.read(request);
      }
      return await coreAdapterFor(runtime, request.projectId).read(request);
    },
    apply: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.apply(request);
      }
      return await coreAdapterFor(runtime, request.projectId).apply(request);
    },
  };
};

export const mapCoreDatabaseEvent = (
  envelope: CoreEventEnvelope,
  libraryId: string,
): DatabaseChangeEvent | null => {
  const payload = envelope.event.payload;
  if (payload.module !== "database") return null;
  const operationId = envelope.event.operation_id;
  if (!operationId) return null;
  return {
    version: DATABASE_CHANGE_EVENT_VERSION,
    projectId: payload.event.project_id,
    libraryId,
    storeEpoch: envelope.event.store_epoch,
    operationId,
    sourceKind: "database_module",
    affectedDatabaseIds: payload.event.database_ids,
    affectedDataSourceIds: payload.event.data_source_ids,
    affectedPageIds: payload.event.page_ids,
    affectedViewIds: payload.event.view_ids,
    changeLogSeq: envelope.event.sequence,
  };
};
