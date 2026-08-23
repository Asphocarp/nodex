import type { DatabasePage } from "../../shared/types";
import type {
  DatabaseListWindowInput,
  DatabaseListWindowSnapshot,
  DatabaseViewGroupsInput,
  DatabaseViewGroupsSnapshot,
  DatabaseViewReadModel,
  DatabaseViewWindowInput,
  DatabaseViewWindowSnapshot,
  LibraryDatabaseListWindowSnapshot,
  LibraryDatabaseViewGroupsSnapshot,
  LibraryDatabaseViewWindowSnapshot,
  ReadDatabaseViewReferenceInput,
} from "../../shared/database-views";
import type { ProjectionCursor } from "../../shared/projection-stream";
import { evaluateDatabaseViewRows } from "../../shared/database-views";
import {
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
import type { DatabaseChangeEvent } from "../../shared/database-events";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
} from "../../shared/database-identities";
import { stableStringifyDatabaseJson, type DatabaseJsonValue } from "../../shared/database-kernel";
import type { LibraryNavigationChangedEvent } from "../../shared/library-events";
import type {
  DesktopDataAuthorityRuntime,
  RustDataAuthorityRuntime,
} from "./desktop-data-authority";
import type { CoreAuthorizedDeliveryAtom, CoreEventEnvelope, DatabaseRead } from "./types";
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
} from "../../shared/database-page-projection";
import { projectCoreDatabaseQueryRow } from "../../shared/core-database-row-projection";
import { toCoreDatabaseViewPresentationOverride } from "./database-presentation-adapter";
import {
  projectCoreDatabaseEvent,
  projectCoreLibraryDatabaseEvent,
} from "../core-runtime/CoreApplicationEventProjection";

export interface DesktopDatabaseModuleBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
}

export interface DesktopDatabaseModuleBridge {
  read(request: DatabaseModuleReadRequestV2): Promise<DatabaseModuleReadResultV2>;
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
  getDatabaseListWindow(
    projectId: string,
    input: DatabaseListWindowInput,
  ): Promise<DatabaseListWindowSnapshot>;
  getDatabaseViewGroups(
    projectId: string,
    input: DatabaseViewGroupsInput,
  ): Promise<DatabaseViewGroupsSnapshot>;
  getLibraryDatabaseViewWindow(
    input: DatabaseViewWindowInput &
      ({ readonly databaseViewId: string } | { readonly databaseId: string }),
  ): Promise<LibraryDatabaseViewWindowSnapshot>;
  getLibraryDatabaseListWindow(
    input: DatabaseListWindowInput &
      ({ readonly databaseViewId: string } | { readonly databaseId: string }),
  ): Promise<LibraryDatabaseListWindowSnapshot>;
  getLibraryDatabaseViewGroups(
    input: DatabaseViewGroupsInput &
      ({ readonly databaseViewId: string } | { readonly databaseId: string }),
  ): Promise<LibraryDatabaseViewGroupsSnapshot>;
  getDatabaseRowPage(
    projectId: string,
    pageId: string,
    status?: DatabasePage["status"],
    minimumCommitCursor?: ProjectionCursor,
  ): Promise<DatabasePage | null>;
  resolveDatabaseViewReference(
    input: ReadDatabaseViewReferenceInput,
  ): Promise<DatabaseViewReadModel | null>;
}

type DescriptorReadResult = DatabaseModuleReadResultV2 | LibraryDatabaseModuleReadResultV2;

const minimumCommitSeqForEpoch = (
  input: DatabaseViewWindowInput | DatabaseViewGroupsInput | DatabaseListWindowInput,
  currentStoreEpoch: string,
): number => {
  const cursor = input.minimumCommitCursor;
  if (!cursor) return input.minimumCommitSeq ?? 0;
  if (cursor.storeEpoch !== currentStoreEpoch) return 0;
  return Math.max(input.minimumCommitSeq ?? 0, cursor.commitSeq);
};

const coreViewTarget = (
  input: DatabaseViewWindowInput | DatabaseViewGroupsInput | DatabaseListWindowInput,
): Extract<DatabaseRead, { readonly kind: "view_window" }>["target"] => {
  if (input.presentationOverride && !input.databaseViewId) {
    throw new Error("A Database View presentation override requires an explicit View");
  }
  if (input.databaseViewId && input.presentationOverride) {
    return {
      kind: "presented_view",
      view_id: input.databaseViewId,
      presentation_override: toCoreDatabaseViewPresentationOverride(input.presentationOverride),
    };
  }
  if (input.databaseViewId) {
    return { kind: "view", view_id: input.databaseViewId };
  }
  if (input.databaseId) {
    return { kind: "database", database_id: input.databaseId };
  }
  return { kind: "project_default" };
};

const readBoundedDatabaseViewWindow = async <ProjectScope extends string | null>(input: {
  readonly projectId: ProjectScope;
  readonly libraryId: string;
  readonly currentStoreEpoch: string;
  readonly windowInput: DatabaseViewWindowInput;
  readonly readCore: CoreDatabaseModuleAdapter["readCore"];
  readonly readDescriptor: (read: DatabaseReadV2) => Promise<DescriptorReadResult>;
}): Promise<DatabaseViewWindowSnapshot<ProjectScope>> => {
  const minimumCommitSeq = minimumCommitSeqForEpoch(input.windowInput, input.currentStoreEpoch);
  const snapshot = await input.readCore(
    {
      kind: "view_window",
      target: coreViewTarget(input.windowInput),
      window: {
        after: input.windowInput.after ?? null,
        first: input.windowInput.first ?? 50,
      },
      ...(input.windowInput.groupScope
        ? {
            group_scope: {
              kind: "path" as const,
              group_key: input.windowInput.groupScope.groupKey,
              subgroup_key: input.windowInput.groupScope.subgroupKey,
            },
          }
        : {}),
    },
    minimumCommitSeq,
  );
  if (snapshot.value.kind !== "view_window") {
    throw new Error("Database Core returned a non-window View snapshot");
  }
  const value = snapshot.value.value;
  if (!snapshot.authorization) {
    throw new Error("Database View read omitted canonical authorization");
  }
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
    viewResult.value.value.kind !== "view" ||
    databaseResult.value.value.kind !== "database" ||
    sourceResult.value.value.kind !== "data_source"
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
    subgroupKey: value.rows.items[index]?.effective_subgroup_key ?? null,
    rankKey: value.rows.items[index]?.rank_key ?? "ffffffffffffffffffffffffffffffff",
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
    authorization: snapshot.authorization,
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
      defaultLayout: descriptor.defaultLayout,
      config: JSON.parse(stableStringifyDatabaseJson(descriptor.config)) as Readonly<
        Record<string, DatabaseJsonValue>
      >,
      isPrimary: descriptor.isDefault,
      createdAt: descriptor.createdAt,
      updatedAt: descriptor.updatedAt,
    },
  };
};

const readBoundedDatabaseListWindow = async <ProjectScope extends string | null>(input: {
  readonly projectId: ProjectScope;
  readonly libraryId: string;
  readonly currentStoreEpoch: string;
  readonly windowInput: DatabaseListWindowInput;
  readonly readCore: CoreDatabaseModuleAdapter["readCore"];
  readonly readDescriptor: (read: DatabaseReadV2) => Promise<DescriptorReadResult>;
}): Promise<DatabaseListWindowSnapshot<ProjectScope>> => {
  const minimumCommitSeq = minimumCommitSeqForEpoch(input.windowInput, input.currentStoreEpoch);
  const snapshot = await input.readCore(
    {
      kind: "list_window",
      target: coreViewTarget(input.windowInput),
      window: {
        after: input.windowInput.after ?? null,
        first: input.windowInput.first ?? 200,
      },
    },
    minimumCommitSeq,
  );
  if (snapshot.value.kind !== "list_window") {
    throw new Error("Database Core returned a non-List View snapshot");
  }
  if (!snapshot.authorization) {
    throw new Error("Database List read omitted canonical authorization");
  }
  const value = snapshot.value.value;
  const sourceResult = await input.readDescriptor({
    target: {
      kind: "data_source",
      dataSourceId: parseDataSourceId(value.data_source_id),
    },
    mode: "data_source",
    minimumCommitSeq,
  });
  if (!sourceResult.ok) {
    throw new Error(
      `Data Source descriptor read failed (${sourceResult.error.code}): ${sourceResult.error.message}`,
    );
  }
  if (sourceResult.value.value.kind !== "data_source") {
    throw new Error("Database Core returned a non-Data Source descriptor");
  }
  const properties = sourceResult.value.value.value.properties;
  const dataSourceId = parseDataSourceId(value.data_source_id);
  return {
    projectId: input.projectId,
    libraryId: input.libraryId,
    databaseId: value.database_id,
    dataSourceId: value.data_source_id,
    viewId: value.view_id,
    storeEpoch: snapshot.store_epoch,
    commitSeq: snapshot.commit_head,
    authorization: snapshot.authorization,
    projection: {
      scopeKey: value.projection.scope.canonical_key,
      schemaVersion: value.projection.scope.schema_version,
      revision: value.projection.revision,
      coveredCommitSeq: value.projection.covered_commit_seq,
      effectHash: value.projection.effect_hash ?? null,
    },
    nextCursor: value.rows.next_cursor ?? null,
    rows: value.rows.items.map((row) => {
      if (row.kind === "group") {
        return {
          kind: row.kind,
          occurrenceKey: row.occurrence_key,
          groupKey: row.group_key ?? null,
          totalOccurrenceCount: row.total_occurrence_count,
        };
      }
      if (row.kind === "subgroup") {
        return {
          kind: row.kind,
          occurrenceKey: row.occurrence_key,
          groupKey: row.group_key ?? null,
          subgroupKey: row.subgroup_key ?? null,
          totalOccurrenceCount: row.total_occurrence_count,
        };
      }
      return {
        kind: row.kind,
        occurrenceKey: row.occurrence_key,
        row: projectCoreDatabaseQueryRow(row.summary, {
          libraryId: input.libraryId,
          dataSourceId,
          properties,
        }),
        groupPath: row.group_path.map((key) => key ?? null),
        ancestorPageIds: row.ancestor_page_ids,
        depth: row.depth,
        hasChildren: row.has_children,
        subtreeOccurrenceCount: row.subtree_occurrence_count,
        concreteSubtreePageCount: row.concrete_subtree_page_count,
        subtreeHeight: row.subtree_height,
        firstChildOccurrenceKey: row.first_child_occurrence_key ?? null,
        transientKind: row.transient_kind,
      };
    }),
    groups: value.groups.map((group) => ({
      groupKey: group.group_key ?? null,
      subgroupKey: group.subgroup_key ?? null,
      totalOccurrenceCount: group.total_occurrence_count,
    })),
    totalProjectionRowCount: value.total_projection_row_count,
    totalOccurrenceCount: value.total_occurrence_count,
    totalModelCount: value.total_model_count,
    windowStart: value.window_start,
    windowEnd: value.window_end,
    isComplete: value.is_complete,
  };
};

const readBoundedDatabaseViewGroups = async <ProjectScope extends string | null>(input: {
  readonly projectId: ProjectScope;
  readonly libraryId: string;
  readonly currentStoreEpoch: string;
  readonly groupsInput: DatabaseViewGroupsInput;
  readonly readCore: CoreDatabaseModuleAdapter["readCore"];
}): Promise<DatabaseViewGroupsSnapshot<ProjectScope>> => {
  const minimumCommitSeq = minimumCommitSeqForEpoch(input.groupsInput, input.currentStoreEpoch);
  const snapshot = await input.readCore(
    {
      kind: "view_groups",
      target: coreViewTarget(input.groupsInput),
    },
    minimumCommitSeq,
  );
  if (snapshot.value.kind !== "view_groups") {
    throw new Error("Database Core returned a non-groups View snapshot");
  }
  if (!snapshot.authorization) {
    throw new Error("Database View groups read omitted canonical authorization");
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
    authorization: snapshot.authorization,
    projection: {
      scopeKey: value.projection.scope.canonical_key,
      schemaVersion: value.projection.scope.schema_version,
      revision: value.projection.revision,
      coveredCommitSeq: value.projection.covered_commit_seq,
      effectHash: value.projection.effect_hash ?? null,
    },
    grouped: value.grouped,
    subgrouped: value.subgrouped,
    totalRows: value.total_rows,
    totalGroups: value.total_groups,
    groupLimit: value.group_limit,
    truncated: value.truncated,
    groups: value.groups.map((group) => ({
      groupKey: group.group_key ?? null,
      subgroupKey: group.subgroup_key ?? null,
      totalRows: group.total_rows,
    })),
  };
};

export const createDesktopDatabaseModuleBridge = (
  input: DesktopDatabaseModuleBridgeInput,
): DesktopDatabaseModuleBridge => {
  const coreAdapters = new Map<string, CoreDatabaseModuleAdapter>();
  let libraryCoreAdapter: CoreLibraryDatabaseModuleAdapter | null = null;
  let adapterStoreEpoch: string | null = null;
  const fenceAdaptersForEpoch = (storeEpoch: string): void => {
    if (adapterStoreEpoch === storeEpoch) return;
    coreAdapters.clear();
    libraryCoreAdapter = null;
    adapterStoreEpoch = storeEpoch;
  };
  const coreAdapterFor = (
    runtime: RustDataAuthorityRuntime,
    projectId: string,
  ): CoreDatabaseModuleAdapter => {
    fenceAdaptersForEpoch(runtime.identity.storeEpoch);
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
    fenceAdaptersForEpoch(runtime.identity.storeEpoch);
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
        currentStoreEpoch: runtime.identity.storeEpoch,
        windowInput,
        readCore: adapter.readCore,
        readDescriptor: async (read) =>
          await adapter.read({
            projectId,
            read,
          }),
      });
    },
    getDatabaseListWindow: async (projectId, windowInput) => {
      const runtime = await input.authority;
      const adapter = coreAdapterFor(runtime, projectId);
      return await readBoundedDatabaseListWindow({
        projectId,
        libraryId: runtime.identity.libraryId,
        currentStoreEpoch: runtime.identity.storeEpoch,
        windowInput,
        readCore: adapter.readCore,
        readDescriptor: async (read) =>
          await adapter.read({
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
        currentStoreEpoch: runtime.identity.storeEpoch,
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
        currentStoreEpoch: runtime.identity.storeEpoch,
        windowInput,
        readCore: adapter.readCore,
        readDescriptor: async (read) =>
          await adapter.read({
            read: read as LibraryDatabaseReadV2,
          }),
      });
    },
    getLibraryDatabaseListWindow: async (windowInput) => {
      const runtime = await input.authority;
      const adapter = libraryAdapterFor(runtime);
      return await readBoundedDatabaseListWindow({
        projectId: null,
        libraryId: runtime.identity.libraryId,
        currentStoreEpoch: runtime.identity.storeEpoch,
        windowInput,
        readCore: adapter.readCore,
        readDescriptor: async (read) =>
          await adapter.read({
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
        currentStoreEpoch: runtime.identity.storeEpoch,
        groupsInput,
        readCore: adapter.readCore,
      });
    },
    getDatabaseRowPage: async (projectId, pageId, status, minimumCommitCursor) => {
      const runtime = await input.authority;
      const minimumCommitSeq =
        minimumCommitCursor && minimumCommitCursor.storeEpoch === runtime.identity.storeEpoch
          ? minimumCommitCursor.commitSeq
          : 0;
      try {
        const snapshot = await coreAdapterFor(runtime, projectId).readCore(
          {
            kind: "row_detail",
            page_id: pageId,
          },
          minimumCommitSeq,
        );
        if (snapshot.value.kind !== "row_detail") {
          throw new Error("Database Core returned a non-detail Page snapshot");
        }
        const page = projectCoreDatabaseRowDetail(snapshot.value.value);
        if (status && page.status !== status) return null;
        return page;
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("authorization") ||
            error.message.includes("not found") ||
            error.message.includes("unavailable"))
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
        const window =
          referenceInput.accessContext.kind === "library"
            ? await bridge.getLibraryDatabaseViewWindow({
                databaseViewId: viewId,
                first: 50,
              })
            : await bridge.getDatabaseViewWindow(referenceInput.accessContext.projectId, {
                databaseViewId: viewId,
                first: 50,
              });
        const model: DatabaseViewReadModel = {
          libraryId: window.libraryId,
          storeEpoch: window.storeEpoch,
          commitSeq: window.commitSeq,
          authorization: window.authorization,
          dataSourceId: window.dataSourceId,
          view: window.view,
          rows: window.rows,
        };
        const rows = evaluateDatabaseViewRows(model, {
          ...(referenceInput.hostBlockId ? { hostBlockId: referenceInput.hostBlockId } : {}),
        });
        return rows === model.rows ? model : { ...model, rows };
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("authorization") ||
            error.message.includes("not found") ||
            error.message.includes("unavailable"))
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
  effect: CoreAuthorizedDeliveryAtom,
  libraryId: string,
): DatabaseChangeEvent | null => projectCoreDatabaseEvent(envelope, effect, libraryId);

export const mapCoreLibraryDatabaseEvent = (
  envelope: CoreEventEnvelope,
  effect: CoreAuthorizedDeliveryAtom,
  libraryId: string,
): LibraryNavigationChangedEvent | null =>
  projectCoreLibraryDatabaseEvent(envelope, effect, libraryId);
