import type {
  DatabasePage,
} from "../../shared/types";
import type {
  DatabaseViewGroupsInput,
  DatabaseViewGroupsSnapshot,
  DatabaseViewReadModel,
  DatabaseViewWindowInput,
  DatabaseViewWindowSnapshot,
  LibraryDatabaseViewGroupsSnapshot,
  LibraryDatabaseViewWindowSnapshot,
  ReadDatabaseViewReferenceInput,
} from "../../shared/database-views";
import { evaluateDatabaseViewRows } from "../../shared/database-views";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseApplyResultV2,
  type DatabaseApplyV2,
  type DatabaseModuleReadRequestV2,
  type DatabaseModuleReadResultV2,
  type DatabaseReadV2,
  type LibraryDatabaseApplyResultV2,
  type LibraryDatabaseApplyV2,
  type LibraryDatabaseModuleReadRequestV2,
  type LibraryDatabaseModuleReadResultV2,
  type LibraryDatabaseReadV2,
} from "../../shared/database-module-v2";
import {
  DATABASE_CHANGE_EVENT_VERSION,
  type DatabaseChangeEvent,
} from "../../shared/database-events";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
} from "../../shared/database-identities";
import {
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
} from "../../shared/database-kernel";
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
  projectCoreDatabaseRowDetail,
  projectCoreDatabaseRowSummaries,
  projectCoreDatabaseViewBoard,
  projectCoreDatabaseViewQuery,
  overlayCanonicalDatabaseRows,
  projectCanonicalDatabaseViewGroups,
} from "./database-page-projection";
import {
  blockRecordSnapshotToWindow,
  type BlockRecordWindow,
} from "../../shared/block-records";

export interface DesktopDatabaseModuleBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
}

export interface DesktopDatabaseModuleBridge {
  read(
    request: DatabaseModuleReadRequestV2,
  ): Promise<DatabaseModuleReadResultV2>;
  apply(request: DatabaseApplyV2): Promise<DatabaseApplyResultV2>;
  readLibrary(
    request: LibraryDatabaseModuleReadRequestV2,
    accessActor?: "app_window" | "http_loopback",
  ): Promise<LibraryDatabaseModuleReadResultV2>;
  applyLibrary(
    request: LibraryDatabaseApplyV2,
    identity?: Readonly<{
      actor: DatabaseApplyV2["actor"];
      accessActor: "app_window" | "http_loopback";
    }>,
  ): Promise<LibraryDatabaseApplyResultV2>;
  getDatabaseViewWindow(
    projectId: string,
    input: DatabaseViewWindowInput,
  ): Promise<DatabaseViewWindowSnapshot>;
  getDatabaseViewGroups(
    projectId: string,
    input: DatabaseViewGroupsInput,
  ): Promise<DatabaseViewGroupsSnapshot>;
  getLibraryDatabaseViewWindow(
    input: DatabaseViewWindowInput & (
      | { readonly databaseViewId: string }
      | { readonly databaseId: string }
    ),
  ): Promise<LibraryDatabaseViewWindowSnapshot>;
  getLibraryDatabaseViewGroups(
    input: DatabaseViewGroupsInput & (
      | { readonly databaseViewId: string }
      | { readonly databaseId: string }
    ),
  ): Promise<LibraryDatabaseViewGroupsSnapshot>;
  getDatabaseRowPage(
    projectId: string,
    pageId: string,
    status?: DatabasePage["status"],
  ): Promise<DatabasePage | null>;
  resolveDatabaseViewReference(
    input: ReadDatabaseViewReferenceInput,
  ): Promise<DatabaseViewReadModel | null>;
}

type DescriptorReadResult =
  | DatabaseModuleReadResultV2
  | LibraryDatabaseModuleReadResultV2;

const readBoundedDatabaseViewWindow = async <
  ProjectScope extends string | null,
>(input: {
  readonly projectId: ProjectScope;
  readonly libraryId: string;
  readonly windowInput: DatabaseViewWindowInput;
  readonly readCore: CoreDatabaseModuleAdapter["readCore"];
  readonly readDescriptor: (
    read: DatabaseReadV2,
  ) => Promise<DescriptorReadResult>;
  readonly readCanonicalWindow: (
    dataSourceId: string,
    viewId: string,
  ) => Promise<BlockRecordWindow>;
}): Promise<DatabaseViewWindowSnapshot<ProjectScope>> => {
  const minimumCommitSeq = input.windowInput.minimumCommitSeq ?? 0;
  const snapshot = await input.readCore({
    target: input.windowInput.databaseViewId
      ? { kind: "view", view_id: input.windowInput.databaseViewId }
      : input.windowInput.databaseId
      ? { kind: "database", database_id: input.windowInput.databaseId }
      : { kind: "project_default" },
    mode: "view_window",
    filter: null,
    sort: null,
    page_ids: null,
    window: {
      after: input.windowInput.after ?? null,
      first: input.windowInput.first ?? 50,
    },
    ...(input.windowInput.groupScope
      ? { group_scope: input.windowInput.groupScope }
      : {}),
  }, minimumCommitSeq);
  if (snapshot.value.kind !== "view_window") {
    throw new Error("Database Core returned a non-window View snapshot");
  }
  const value = snapshot.value.value;
  const [viewResult, databaseResult, sourceResult] = await Promise.all([
    input.readDescriptor({
      target: {
        kind: "view",
        viewId: parseDatabaseViewId(value.view_id),
      },
      mode: "view",
      minimumCommitSeq,
    }),
    input.readDescriptor({
      target: {
        kind: "database",
        databaseId: parseDatabaseId(value.database_id),
      },
      mode: "database",
      minimumCommitSeq,
    }),
    input.readDescriptor({
      target: {
        kind: "data_source",
        dataSourceId: parseDataSourceId(value.data_source_id),
      },
      mode: "data_source",
      minimumCommitSeq,
    }),
  ]);
  if (!viewResult.ok) {
    throw new Error(
      `Database View descriptor read failed (${viewResult.error.code}): ${viewResult.error.message}`,
    );
  }
  if (!databaseResult.ok) {
    throw new Error(
      `Database descriptor read failed (${databaseResult.error.code}): ${databaseResult.error.message}`,
    );
  }
  if (!sourceResult.ok) {
    throw new Error(
      `Data Source descriptor read failed (${sourceResult.error.code}): ${sourceResult.error.message}`,
    );
  }
  if (
    viewResult.value.value.kind !== "view"
    || databaseResult.value.value.kind !== "database"
    || sourceResult.value.value.kind !== "data_source"
  ) {
    throw new Error("Database Core returned a non-View descriptor");
  }
  const canonicalWindow = await input.readCanonicalWindow(
    value.data_source_id,
    value.view_id,
  );
  const descriptor = viewResult.value.value.value;
  const databaseDescriptor = databaseResult.value.value.value;
  const sourceDescriptor = sourceResult.value.value.value;
  const canonicalGroups = projectCanonicalDatabaseViewGroups(
    canonicalWindow,
    descriptor.config,
  );
  const canonicalRows = overlayCanonicalDatabaseRows(
    value.rows.items,
    canonicalWindow,
  );
  const summaries = projectCoreDatabaseRowSummaries(canonicalRows);
  const rows = summaries.map((page, index) => ({
    page,
    groupKey:
      canonicalGroups.groupKeysByPageId.get(page.id)
      ?? value.rows.items[index]?.effective_group_key
      ?? null,
    rankKey:
      canonicalGroups.rankKeysByPageId.get(page.id)
      ?? value.rows.items[index]?.rank_key
      ?? "ffffffffffffffffffffffffffffffff",
  }));
  const query = projectCoreDatabaseViewQuery(
    value,
    input.libraryId,
    databaseDescriptor,
    sourceDescriptor,
    descriptor,
    canonicalWindow,
  );
  return {
    projectId: input.projectId,
    libraryId: input.libraryId,
    databaseId: value.database_id,
    dataSourceId: value.data_source_id,
    viewId: value.view_id,
    storeEpoch: snapshot.store_epoch,
    changeLogSeq: snapshot.event_head,
    projectionRevision: value.rows.authority.projection_revision,
    nextCursor: value.rows.next_cursor ?? null,
    rows,
    board: projectCoreDatabaseViewBoard(canonicalRows),
    query,
    view: {
      id: descriptor.viewId,
      databaseBlockId: descriptor.databaseId,
      projectId: input.projectId,
      name: descriptor.name,
      kind: descriptor.kind,
      config: JSON.parse(
        stableStringifyDatabaseJson(descriptor.config),
      ) as Readonly<Record<string, DatabaseJsonValue>>,
      isPrimary: descriptor.isDefault,
      createdAt: descriptor.createdAt,
      updatedAt: descriptor.updatedAt,
    },
  };
};

const readBoundedDatabaseViewGroups = async <
  ProjectScope extends string | null,
>(input: {
  readonly projectId: ProjectScope;
  readonly libraryId: string;
  readonly groupsInput: DatabaseViewGroupsInput;
  readonly readCore: CoreDatabaseModuleAdapter["readCore"];
  readonly readDescriptor: (
    read: DatabaseReadV2,
  ) => Promise<DescriptorReadResult>;
  readonly readCanonicalWindow: (
    dataSourceId: string,
    viewId: string,
  ) => Promise<BlockRecordWindow>;
}): Promise<DatabaseViewGroupsSnapshot<ProjectScope>> => {
  const minimumCommitSeq = input.groupsInput.minimumCommitSeq ?? 0;
  const snapshot = await input.readCore({
    target: input.groupsInput.databaseViewId
      ? { kind: "view", view_id: input.groupsInput.databaseViewId }
      : input.groupsInput.databaseId
      ? { kind: "database", database_id: input.groupsInput.databaseId }
      : { kind: "project_default" },
    mode: "view_groups",
    filter: null,
    sort: null,
    page_ids: null,
    window: null,
  }, minimumCommitSeq);
  if (snapshot.value.kind !== "view_groups") {
    throw new Error("Database Core returned a non-groups View snapshot");
  }
  const value = snapshot.value.value;
  const viewResult = await input.readDescriptor({
    target: {
      kind: "view",
      viewId: parseDatabaseViewId(value.view_id),
    },
    mode: "view",
    minimumCommitSeq,
  });
  if (!viewResult.ok) {
    throw new Error(
      `Database View descriptor read failed (${viewResult.error.code}): ${viewResult.error.message}`,
    );
  }
  if (viewResult.value.value.kind !== "view") {
    throw new Error("Database Core returned a non-View descriptor");
  }
  const canonicalWindow = await input.readCanonicalWindow(
    value.data_source_id,
    value.view_id,
  );
  if (
    canonicalWindow.libraryId !== input.libraryId
    || canonicalWindow.observedLocalCommit.storeEpoch.length === 0
    || canonicalWindow.observedLocalCommit.commitSeq < minimumCommitSeq
  ) {
    throw new Error("Canonical Database View groups did not reach the requested commit");
  }
  const canonicalGroups = projectCanonicalDatabaseViewGroups(
    canonicalWindow,
    viewResult.value.value.value.config,
  );
  return {
    projectId: input.projectId,
    libraryId: input.libraryId,
    databaseId: value.database_id,
    dataSourceId: value.data_source_id,
    viewId: value.view_id,
    storeEpoch: snapshot.store_epoch,
    changeLogSeq: canonicalWindow.observedLocalCommit.commitSeq,
    grouped: canonicalGroups.grouped,
    totalRows: canonicalGroups.totalRows,
    truncated: canonicalGroups.truncated,
    groups: canonicalGroups.groups.map((group) => ({
      groupKey: group.groupKey,
      totalRows: group.totalRows,
    })),
  };
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
      libraryId: runtime.identity.libraryId,
      storeEpoch: runtime.identity.storeEpoch,
    });
    coreAdapters.set(projectId, adapter);
    return adapter;
  };

  const libraryAdapterFor = (
    runtime: RustDataAuthorityRuntime,
  ): CoreLibraryDatabaseModuleAdapter => {
    libraryCoreAdapter ??= createCoreLibraryDatabaseModuleAdapter({
      client: runtime.rootClient,
      libraryId: runtime.identity.libraryId,
      storeEpoch: runtime.identity.storeEpoch,
    });
    return libraryCoreAdapter;
  };

  const bridge: DesktopDatabaseModuleBridge = {
    read: async (request) => {
      const runtime = await input.authority;
      return await coreAdapterFor(runtime, request.projectId).read(request);
    },
    apply: async (request) => {
      const runtime = await input.authority;
      return await coreAdapterFor(runtime, request.projectId).apply(request);
    },
    readLibrary: async (request) => {
      const runtime = await input.authority;
      return await libraryAdapterFor(runtime).read(request);
    },
    applyLibrary: async (request) => {
      const runtime = await input.authority;
      return await libraryAdapterFor(runtime).apply(request);
    },
    getDatabaseViewWindow: async (projectId, windowInput) => {
      const runtime = await input.authority;
      const adapter = coreAdapterFor(runtime, projectId);
      return await readBoundedDatabaseViewWindow({
        projectId,
        libraryId: runtime.identity.libraryId,
        windowInput,
        readCore: adapter.readCore,
        readDescriptor: async (read) => await adapter.read({
          version: DATABASE_MODULE_V2_CONTRACT_VERSION,
          projectId,
          read,
        }),
        readCanonicalWindow: async (dataSourceId, viewId) => {
          const read = {
            kind: "window" as const,
            parent: { kind: "data_source" as const, id: dataSourceId },
            view_id: viewId,
            include_content: false,
            include_descendants: false,
            include_archived: false,
          };
          const snapshot = await runtime
            .clientForProject(projectId)
            .blockRecordRead(read);
          return blockRecordSnapshotToWindow(snapshot, read);
        },
      });
    },
    getDatabaseViewGroups: async (projectId, groupsInput) => {
      const runtime = await input.authority;
      const adapter = coreAdapterFor(runtime, projectId);
      return await readBoundedDatabaseViewGroups({
        projectId,
        libraryId: runtime.identity.libraryId,
        groupsInput,
        readCore: adapter.readCore,
        readDescriptor: async (read) => await adapter.read({
          version: DATABASE_MODULE_V2_CONTRACT_VERSION,
          projectId,
          read,
        }),
        readCanonicalWindow: async (dataSourceId, viewId) => {
          const read = {
            kind: "window" as const,
            parent: { kind: "data_source" as const, id: dataSourceId },
            view_id: viewId,
            include_content: false,
            include_descendants: false,
            include_archived: false,
          };
          const snapshot = await runtime
            .clientForProject(projectId)
            .blockRecordRead(read);
          return blockRecordSnapshotToWindow(snapshot, read);
        },
      });
    },
    getLibraryDatabaseViewWindow: async (windowInput) => {
      const runtime = await input.authority;
      const adapter = libraryAdapterFor(runtime);
      return await readBoundedDatabaseViewWindow({
        projectId: null,
        libraryId: runtime.identity.libraryId,
        windowInput,
        readCore: adapter.readCore,
        readDescriptor: async (read) => await adapter.read({
          version: DATABASE_MODULE_V2_CONTRACT_VERSION,
          read: read as LibraryDatabaseReadV2,
        }),
        readCanonicalWindow: async (dataSourceId, viewId) => {
          const read = {
            kind: "window" as const,
            parent: { kind: "data_source" as const, id: dataSourceId },
            view_id: viewId,
            include_content: false,
            include_descendants: false,
            include_archived: false,
          };
          const snapshot = await runtime.rootClient.blockRecordRead(read);
          return blockRecordSnapshotToWindow(snapshot, read);
        },
      });
    },
    getLibraryDatabaseViewGroups: async (groupsInput) => {
      const runtime = await input.authority;
      const adapter = libraryAdapterFor(runtime);
      return await readBoundedDatabaseViewGroups({
        projectId: null,
        libraryId: runtime.identity.libraryId,
        groupsInput,
        readCore: adapter.readCore,
        readDescriptor: async (read) => await adapter.read({
          version: DATABASE_MODULE_V2_CONTRACT_VERSION,
          read: read as LibraryDatabaseReadV2,
        }),
        readCanonicalWindow: async (dataSourceId, viewId) => {
          const read = {
            kind: "window" as const,
            parent: { kind: "data_source" as const, id: dataSourceId },
            view_id: viewId,
            include_content: false,
            include_descendants: false,
            include_archived: false,
          };
          const snapshot = await runtime.rootClient.blockRecordRead(read);
          return blockRecordSnapshotToWindow(snapshot, read);
        },
      });
    },
    getDatabaseRowPage: async (projectId, pageId, status) => {
      const runtime = await input.authority;
      try {
        const snapshot = await coreAdapterFor(runtime, projectId).readCore({
          target: { kind: "page", page_id: pageId },
          mode: "row_detail",
          filter: null,
          sort: null,
          page_ids: null,
          window: null,
        });
        if (snapshot.value.kind !== "row_detail") {
          throw new Error("Database Core returned a non-detail Page snapshot");
        }
        const page = projectCoreDatabaseRowDetail(snapshot.value.value);
        if (status && page.status !== status) return null;
        return page;
      } catch (error) {
        if (
          error instanceof Error
          && (
            error.message.includes("authorization")
            || error.message.includes("not found")
            || error.message.includes("unavailable")
          )
        ) {
          return null;
        }
        throw error;
      }
    },
    resolveDatabaseViewReference: async (referenceInput) => {
      let viewId;
      try {
        viewId = parseDatabaseViewId(referenceInput.databaseViewId);
      } catch {
        return null;
      }
      try {
        const window = referenceInput.accessContext.kind === "library"
          ? await bridge.getLibraryDatabaseViewWindow({
              databaseViewId: viewId,
              first: 50,
            })
          : await bridge.getDatabaseViewWindow(
              referenceInput.accessContext.projectId,
              { databaseViewId: viewId, first: 50 },
            );
        const model: DatabaseViewReadModel = {
          libraryId: window.libraryId,
          storeEpoch: window.storeEpoch,
          changeLogSeq: window.changeLogSeq,
          dataSourceId: window.dataSourceId,
          view: window.view,
          rows: window.rows,
        };
        const rows = evaluateDatabaseViewRows(model, {
          ...(referenceInput.hostBlockId
            ? { hostBlockId: referenceInput.hostBlockId }
            : {}),
        });
        return rows === model.rows ? model : { ...model, rows };
      } catch (error) {
        if (
          error instanceof Error
          && (
            error.message.includes("authorization")
            || error.message.includes("not found")
            || error.message.includes("unavailable")
          )
        ) {
          return null;
        }
        throw error;
      }
    },
  };
  return bridge;
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
