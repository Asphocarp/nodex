import type {
  DatabaseApplyResultV2,
  DatabaseApplyV2,
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
  LibraryDatabaseApplyResultV2,
  LibraryDatabaseApplyV2,
  LibraryDatabaseModuleReadRequestV2,
  LibraryDatabaseModuleReadResultV2,
} from "../../shared/database-module-v2";
import {
  DATABASE_CHANGE_EVENT_VERSION,
  type DatabaseChangeEvent,
} from "../../shared/database-events";
import {
  parseDatabaseId,
  parseDatabaseViewId,
} from "../../shared/database-identities";
import {
  LIBRARY_NAVIGATION_EVENT_VERSION,
  type LibraryNavigationChangedEvent,
} from "../../shared/library-events";
import type {
  DesktopDataAuthorityRuntime,
  RustDataAuthorityRuntime,
} from "./desktop-data-authority";
import type { CoreEventEnvelope } from "./types";
import {
  createCoreDatabaseModuleAdapter,
  type CoreDatabaseModuleAdapter,
  createCoreLibraryDatabaseModuleAdapter,
  type CoreLibraryDatabaseModuleAdapter,
} from "./database-module-adapter";

export interface DesktopDatabaseModuleBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly typescript: {
    read(
      request: DatabaseModuleReadRequestV2,
    ): Promise<DatabaseModuleReadResultV2>;
    apply(request: DatabaseApplyV2): Promise<DatabaseApplyResultV2>;
    readLibrary(
      request: LibraryDatabaseModuleReadRequestV2,
    ): Promise<LibraryDatabaseModuleReadResultV2>;
    applyLibrary(
      request: LibraryDatabaseApplyV2,
    ): Promise<LibraryDatabaseApplyResultV2>;
  };
}

export interface DesktopDatabaseModuleBridge {
  read(
    request: DatabaseModuleReadRequestV2,
  ): Promise<DatabaseModuleReadResultV2>;
  apply(request: DatabaseApplyV2): Promise<DatabaseApplyResultV2>;
  readLibrary(
    request: LibraryDatabaseModuleReadRequestV2,
  ): Promise<LibraryDatabaseModuleReadResultV2>;
  applyLibrary(
    request: LibraryDatabaseApplyV2,
  ): Promise<LibraryDatabaseApplyResultV2>;
}

export const createDesktopDatabaseModuleBridge = (
  input: DesktopDatabaseModuleBridgeInput,
): DesktopDatabaseModuleBridge => {
  const coreAdapters = new Map<string, CoreDatabaseModuleAdapter>();
  let libraryCoreAdapter: CoreLibraryDatabaseModuleAdapter | null = null;
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

  const libraryAdapterFor = (
    runtime: RustDataAuthorityRuntime,
  ): CoreLibraryDatabaseModuleAdapter => {
    libraryCoreAdapter ??= createCoreLibraryDatabaseModuleAdapter({
      client: runtime.rootClient,
      libraryId: runtime.rootClient.handshake.library_id,
      storeEpoch: runtime.rootClient.handshake.store_epoch,
    });
    return libraryCoreAdapter;
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
    readLibrary: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.readLibrary(request);
      }
      return await libraryAdapterFor(runtime).read(request);
    },
    applyLibrary: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.applyLibrary(request);
      }
      return await libraryAdapterFor(runtime).apply(request);
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
  const projectId = payload.event.project_id;
  if (!operationId || !projectId) return null;
  return {
    version: DATABASE_CHANGE_EVENT_VERSION,
    projectId,
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

export const mapCoreLibraryDatabaseEvent = (
  envelope: CoreEventEnvelope,
  libraryId: string,
): LibraryNavigationChangedEvent | null => {
  const payload = envelope.event.payload;
  if (payload.module !== "database" || payload.event.project_id) return null;
  return {
    version: LIBRARY_NAVIGATION_EVENT_VERSION,
    libraryId,
    storeEpoch: envelope.event.store_epoch,
    changeLogSeq: envelope.event.sequence,
    changeKind: "database",
    affectedParentKeys: [
      "library",
      "catalog",
      ...payload.event.database_ids.map((id) => `database:${id}`),
    ],
    affectedPageIds: payload.event.page_ids,
    affectedDatabaseIds: payload.event.database_ids.map(parseDatabaseId),
    affectedViewIds: payload.event.view_ids.map(parseDatabaseViewId),
  };
};
