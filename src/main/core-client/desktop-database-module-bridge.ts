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
import { findCoreModulePayload, type CoreEventEnvelope } from "./types";
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
} from "./database-page-projection";

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
    minimumCommitSeq?: number,
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
  const descriptor = viewResult.value.value.value;
  const databaseDescriptor = databaseResult.value.value.value;
  const sourceDescriptor = sourceResult.value.value.value;
  const summaries = projectCoreDatabaseRowSummaries(value.rows.items);
  const rows = summaries.map((page, index) => ({
    page,
    groupKey: value.rows.items[index]?.effective_group_key ?? null,
    rankKey:
      value.rows.items[index]?.rank_key
      ?? "ffffffffffffffffffffffffffffffff",
  }));
  const query = projectCoreDatabaseViewQuery(
    value,
    input.libraryId,
    databaseDescriptor,
    sourceDescriptor,
    descriptor,
  );
  return {
    projectId: input.projectId,
    libraryId: input.libraryId,
    databaseId: value.database_id,
    dataSourceId: value.data_source_id,
    viewId: value.view_id,
    storeEpoch: snapshot.store_epoch,
    commitSeq: snapshot.commit_head,
    projection: {
      scopeKey: value.projection.scope.canonical_key,
      schemaVersion: value.projection.scope.schema_version,
      revision: value.projection.revision,
      coveredCommitSeq: value.projection.covered_commit_seq,
      effectHash: value.projection.effect_hash ?? null,
    },
    nextCursor: value.rows.next_cursor ?? null,
    rows,
    board: projectCoreDatabaseViewBoard(value.rows.items),
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
  return {
    projectId: input.projectId,
    libraryId: input.libraryId,
    databaseId: value.database_id,
    dataSourceId: value.data_source_id,
    viewId: value.view_id,
    storeEpoch: snapshot.store_epoch,
    commitSeq: snapshot.commit_head,
    projection: {
      scopeKey: value.projection.scope.canonical_key,
      schemaVersion: value.projection.scope.schema_version,
      revision: value.projection.revision,
      coveredCommitSeq: value.projection.covered_commit_seq,
      effectHash: value.projection.effect_hash ?? null,
    },
    grouped: value.grouped,
    totalRows: value.total_rows,
    truncated: value.truncated,
    groups: value.groups.map((group) => ({
      groupKey: group.group_key ?? null,
      totalRows: group.total_rows,
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
      });
    },
    getDatabaseRowPage: async (projectId, pageId, status, minimumCommitSeq) => {
      const runtime = await input.authority;
      try {
        const snapshot = await coreAdapterFor(runtime, projectId).readCore({
          target: { kind: "page", page_id: pageId },
          mode: "row_detail",
          filter: null,
          sort: null,
          page_ids: null,
          window: null,
        }, minimumCommitSeq);
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
          commitSeq: window.commitSeq,
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
  const payload = findCoreModulePayload(envelope, "database");
  if (payload?.module !== "database") return null;
  const operationId = envelope.packet.manifest.operation_id;
  const projectId = payload.event.project_id;
  if (!operationId || !projectId) return null;
  return {
    version: DATABASE_CHANGE_EVENT_VERSION,
    projectId,
    libraryId,
    storeEpoch: envelope.packet.manifest.identity.store_epoch,
    operationId,
    sourceKind: "database_module",
    affectedDatabaseIds: payload.event.database_ids,
    affectedDataSourceIds: payload.event.data_source_ids,
    affectedPageIds: payload.event.page_ids,
    affectedViewIds: payload.event.view_ids,
    commitSeq: envelope.packet.manifest.identity.commit_seq,
  };
};

export const mapCoreLibraryDatabaseEvent = (
  envelope: CoreEventEnvelope,
  libraryId: string,
): LibraryNavigationChangedEvent | null => {
  const payload = findCoreModulePayload(envelope, "database");
  if (payload?.module !== "database" || payload.event.project_id) return null;
  return {
    version: LIBRARY_NAVIGATION_EVENT_VERSION,
    libraryId,
    storeEpoch: envelope.packet.manifest.identity.store_epoch,
    commitSeq: envelope.packet.manifest.identity.commit_seq,
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
