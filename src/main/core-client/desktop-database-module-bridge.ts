import type {
  BoardSummary,
  DatabasePage,
  DatabaseRowsDetailsInput,
} from "../../shared/types";
import type {
  DatabaseViewReadModel,
  ReadDatabaseViewReferenceInput,
} from "../../shared/database-views";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseApplyResultV2,
  type DatabaseApplyV2,
  type DatabaseModuleReadRequestV2,
  type DatabaseModuleReadResultV2,
  type LibraryDatabaseApplyResultV2,
  type LibraryDatabaseApplyV2,
  type LibraryDatabaseModuleReadRequestV2,
  type LibraryDatabaseModuleReadResultV2,
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
import {
  projectBoardSummary,
  projectDatabasePage,
  projectDatabaseQueryPages,
  projectDatabaseViewReference,
} from "./database-page-projection";

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
    getBoardSummary(projectId: string): Promise<BoardSummary>;
    getDatabaseRowsDetails(
      projectId: string,
      input: DatabaseRowsDetailsInput,
    ): Promise<DatabasePage[]>;
    getDatabaseRowPage(
      projectId: string,
      pageId: string,
      status?: DatabasePage["status"],
    ): Promise<DatabasePage | null>;
    resolveDatabaseViewReference(
      input: ReadDatabaseViewReferenceInput,
    ): Promise<DatabaseViewReadModel | null>;
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
  getBoardSummary(projectId: string): Promise<BoardSummary>;
  getDatabaseRowsDetails(
    projectId: string,
    input: DatabaseRowsDetailsInput,
  ): Promise<DatabasePage[]>;
  getDatabaseRowPage(
    projectId: string,
    pageId: string,
    status?: DatabasePage["status"],
  ): Promise<DatabasePage | null>;
  resolveDatabaseViewReference(
    input: ReadDatabaseViewReferenceInput,
  ): Promise<DatabaseViewReadModel | null>;
}

const requireQuerySnapshot = async (
  adapter: CoreDatabaseModuleAdapter,
  request: DatabaseModuleReadRequestV2,
) => {
  const result = await adapter.read(request);
  if (!result.ok) {
    throw new Error(
      `Database Core read failed (${result.error.code}): ${result.error.message}`,
    );
  }
  if (result.value.value.kind === "query") return result.value.value.value;
  throw new Error("Database Core returned a non-query snapshot");
};

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
    getBoardSummary: async (projectId) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.getBoardSummary(projectId);
      }
      const query = await requireQuerySnapshot(
        coreAdapterFor(runtime, projectId),
        {
          version: DATABASE_MODULE_V2_CONTRACT_VERSION,
          projectId,
          read: { target: { kind: "project_default" }, mode: "query" },
        },
      );
      return projectBoardSummary(query);
    },
    getDatabaseRowsDetails: async (projectId, detailsInput) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.getDatabaseRowsDetails(
          projectId,
          detailsInput,
        );
      }
      const pageIds = Array.from(new Set(
        detailsInput.pageIds.map((pageId) => pageId.trim()).filter(Boolean),
      ));
      if (pageIds.length === 0) return [];
      const query = await requireQuerySnapshot(
        coreAdapterFor(runtime, projectId),
        {
          version: DATABASE_MODULE_V2_CONTRACT_VERSION,
          projectId,
          read: { target: { kind: "project_default" }, mode: "query" },
        },
      );
      const pagesById = new Map(
        projectDatabaseQueryPages(query).map((page) => [page.id, page]),
      );
      return pageIds.flatMap((pageId) => {
        const page = pagesById.get(pageId);
        return page ? [page] : [];
      });
    },
    getDatabaseRowPage: async (projectId, pageId, status) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.getDatabaseRowPage(
          projectId,
          pageId,
          status,
        );
      }
      const result = await coreAdapterFor(runtime, projectId).readPage(pageId);
      if (!result.ok) {
        if (
          result.error.code === "authorization_denied"
          || result.error.code === "resource_not_found"
        ) {
          return null;
        }
        throw new Error(
          `Database Core read failed (${result.error.code}): ${result.error.message}`,
        );
      }
      if (result.value.value.kind !== "data_source_query") {
        throw new Error("Database Core returned a non-row Page snapshot");
      }
      const query = result.value.value.value;
      const [row] = query.rows;
      if (!row) return null;
      if (query.rows.length !== 1 || row.page.pageId !== pageId) {
        throw new Error("Database Core Page query escaped its requested identity");
      }
      const page = projectDatabasePage(row, query.properties);
      if (status && page.status !== status) return null;
      return page;
    },
    resolveDatabaseViewReference: async (referenceInput) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.resolveDatabaseViewReference(
          referenceInput,
        );
      }
      let viewId;
      try {
        viewId = parseDatabaseViewId(referenceInput.databaseViewId);
      } catch {
        return null;
      }
      const result = await coreAdapterFor(
        runtime,
        referenceInput.requestingProjectId,
      ).read({
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: referenceInput.requestingProjectId,
        read: { target: { kind: "view", viewId }, mode: "query" },
      });
      if (!result.ok) {
        if (
          result.error.code === "authorization_denied"
          || result.error.code === "resource_not_found"
        ) {
          return null;
        }
        throw new Error(
          `Database Core read failed (${result.error.code}): ${result.error.message}`,
        );
      }
      if (result.value.value.kind !== "query") {
        throw new Error("Database Core returned a non-query View snapshot");
      }
      return projectDatabaseViewReference(
        result.value.value.value,
        referenceInput,
      );
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
