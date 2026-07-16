import { describe, expect, test } from "vitest";
import type {
  DatabaseApply,
  DatabaseApplyResult,
  DatabaseContainerDescriptor,
  DatabaseModuleReadResult,
  DatabaseModuleReadSnapshot,
  DataSourceDescriptor,
} from "../../shared/database-module";
import {
  commitDatabaseManagementOperations,
  DatabaseManagementMutationError,
  readDatabaseManagementAuthority,
  type DatabaseManagementRuntimeDependencies,
} from "./database-management-runtime";

const timestamp = "2026-07-16T00:00:00.000Z";
const projectId = "project-1";
const libraryId = "library-1";
const databaseId = "database-1";
const dataSourceId = "source-1";

const descriptor = (): DatabaseContainerDescriptor => ({
  database: {
    databaseId,
    libraryId,
    name: "Tasks",
    lifecycle: "active",
    defaultViewId: "view-1",
    accessRevision: 1,
    metadataRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  dataSources: [{
    dataSourceId,
    libraryId,
    homeDatabaseId: databaseId,
    name: "Pages",
    schemaKey: "nodex.pages",
    schemaRevision: 1,
    lifecycle: "active",
    rankKey: "a",
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  views: [{
    viewId: "view-1",
    databaseId,
    dataSourceId,
    name: "Board",
    kind: "kanban",
    config: {
      schemaKey: "nodex.database-view",
      schemaVersion: 1,
      filter: { kind: "group", operator: "and", children: [] },
      sort: [{
        field: { kind: "manual" },
        direction: "asc",
        nulls: "last",
      }],
      group: null,
      display: { propertyIds: [], showTitle: true },
    },
    isDefault: true,
    revision: 1,
    rankKey: "a",
    lifecycle: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
});

const source = (): DataSourceDescriptor => ({
  dataSource: descriptor().dataSources[0]!,
  properties: [{
    propertyId: "property-status",
    dataSourceId,
    key: "status",
    name: "Status",
    valueType: "select",
    config: {},
    rankKey: "a",
    lifecycle: "active",
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
});

const snapshot = (
  value: DatabaseModuleReadSnapshot["value"],
  changeLogSeq = 4,
): DatabaseModuleReadSnapshot => ({
  version: 1,
  projectId,
  libraryId,
  storeEpoch: "epoch-1",
  changeLogSeq,
  value,
});

const readResult = (
  value: DatabaseModuleReadSnapshot["value"],
  changeLogSeq?: number,
): DatabaseModuleReadResult => ({
  ok: true,
  value: snapshot(value, changeLogSeq),
});

const committed = (request: DatabaseApply): DatabaseApplyResult => ({
  ok: true,
  value: {
    version: 1,
    operationId: request.operationId,
    projectId,
    libraryId,
    storeEpoch: request.storeEpoch,
    duplicate: false,
    operationKinds: request.operations.map((operation) => operation.kind),
    affectedDatabaseIds: [databaseId],
    affectedDataSourceIds: [dataSourceId],
    affectedPageIds: [],
    affectedViewIds: [],
    committedRevisions: {},
    changeLogSeq: 5,
    committedAt: timestamp,
  },
});

const readDependency = (
  changeLogSeq = 5,
): DatabaseManagementRuntimeDependencies["read"] => async (
  _projectId,
  request,
) => request.read.mode === "catalog"
  ? readResult({ kind: "catalog", databases: [descriptor()] }, changeLogSeq)
  : readResult({ kind: "data_source", value: source() }, changeLogSeq);

describe("canonical Database management runtime", () => {
  test("reads one selected Container and its initial Data Source", async () => {
    const authority = await readDatabaseManagementAuthority(projectId, null, {
      read: readDependency(),
      apply: async () => {
        throw new Error("apply should not run");
      },
    });

    expect(authority.selectedDatabase.database.databaseId).toBe(databaseId);
    expect(authority.selectedDataSource.dataSourceId).toBe(dataSourceId);
    expect(authority.source.properties[0]?.propertyId).toBe("property-status");
  });

  test("retains one exact Database Apply request across a lost response", async () => {
    const requests: DatabaseApply[] = [];
    const authority = await commitDatabaseManagementOperations({
      projectId,
      operationId: "operation-1",
      clientSessionId: "window-1",
      buildOperations: (current) => [{
        kind: "delete_property",
        dataSourceId: current.selectedDataSource.dataSourceId,
        propertyId: "property-status",
        expectedDataSourceRevision: 1,
        expectedPropertyRevision: 1,
      }],
      dependencies: {
        read: readDependency(),
        apply: async (_projectId, request) => {
          requests.push(request);
          if (requests.length === 1) throw new Error("response lost");
          return committed(request);
        },
      },
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
    expect(requests[0]?.actor).toEqual({
      kind: "renderer_database_management",
      clientSessionId: "window-1",
    });
    expect(authority.snapshot.changeLogSeq).toBe(5);
  });

  test("surfaces typed authorization failures", async () => {
    await expect(commitDatabaseManagementOperations({
      projectId,
      operationId: "operation-denied",
      buildOperations: () => [{
        kind: "delete_view",
        databaseId,
        viewId: "view-1",
        expectedRevision: 1,
      }],
      dependencies: {
        read: readDependency(),
        apply: async () => ({
          ok: false,
          error: {
            code: "authorization_denied",
            message: "Manage Views denied",
            retryable: false,
          },
        }),
      },
    })).rejects.toBeInstanceOf(DatabaseManagementMutationError);
  });
});
