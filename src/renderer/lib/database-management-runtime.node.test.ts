import { describe, expect, test } from "vitest";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseApplyResultV2,
  type DatabaseApplyV2,
  type DatabaseContainerDescriptorV2,
  type DatabaseModuleReadResultV2,
  type DatabaseModuleReadSnapshotV2,
  type DataSourceDescriptorV2,
} from "../../shared/database-module-v2";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import { testPropertySemantics } from "../../shared/testing/database-property-record";
import {
  commitDatabaseManagementOperations,
  DatabaseManagementMutationError,
  readDatabaseManagementAuthority,
  type DatabaseManagementRuntimeDependencies,
} from "./database-management-runtime";

const timestamp = "2026-07-16T00:00:00.000Z";
const projectId = "project-1";
const libraryId = "library-1";
const databaseId = parseDatabaseId("database-1");
const dataSourceId = parseDataSourceId("source-1");
const viewId = parseDatabaseViewId("view-1");

const descriptor = (): DatabaseContainerDescriptorV2 => ({
  database: {
    databaseId,
    libraryId,
    name: "Tasks",
    lifecycle: "active",
    defaultViewId: viewId,
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
    viewId,
    databaseId,
    dataSourceId,
    name: "Board",
    kind: "kanban",
    config: {
      schemaKey: "nodex.database-view",
      schemaVersion: 2,
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

const source = (): DataSourceDescriptorV2 => ({
  dataSource: descriptor().dataSources[0]!,
  properties: [{
    propertyId: parseDataSourcePropertyId("status"),
    dataSourceId,
    name: "Status",
    ...testPropertySemantics("select"),
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
  value: DatabaseModuleReadSnapshotV2["value"],
  commitSeq = 4,
): DatabaseModuleReadSnapshotV2 => ({
  version: DATABASE_MODULE_V2_CONTRACT_VERSION,
  projectId,
  libraryId,
  storeEpoch: "epoch-1",
  commitSeq,
  value,
});

const readResult = (
  value: DatabaseModuleReadSnapshotV2["value"],
  commitSeq?: number,
): DatabaseModuleReadResultV2 => ({
  ok: true,
  value: snapshot(value, commitSeq),
});

const committed = (request: DatabaseApplyV2): DatabaseApplyResultV2 => ({
  ok: true,
  value: {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
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
    commitSeq: 5,
    committedAt: timestamp,
  },
});

const readDependency = (
  commitSeq = 5,
): DatabaseManagementRuntimeDependencies["read"] => async (
  _projectId,
  request,
) => request.read.mode === "database"
  ? readResult({ kind: "database", value: descriptor() }, commitSeq)
  : request.read.mode === "catalog_window"
    ? readResult({
        kind: "catalog_window",
        value: {
          databases: [descriptor()],
          nextCursor: null,
          projectionRevision: commitSeq,
        },
      }, commitSeq)
    : readResult({ kind: "data_source", value: source() }, commitSeq);

describe("canonical Database management runtime", () => {
  test("reads the authorized Database catalog and selected Data Source", async () => {
    const authority = await readDatabaseManagementAuthority(projectId, null, {
      read: readDependency(),
      apply: async () => {
        throw new Error("apply should not run");
      },
    });

    expect(authority.selectedDatabase.database.databaseId).toBe(databaseId);
    expect(authority.selectedDataSource.dataSourceId).toBe(dataSourceId);
    expect(authority.source.properties[0]?.propertyId).toBe("status");
  });

  test("retains one exact Database Apply request across a lost response", async () => {
    const requests: DatabaseApplyV2[] = [];
    const authority = await commitDatabaseManagementOperations({
      projectId,
      operationId: "operation-1",
      buildOperations: (current) => [{
        kind: "delete_property",
        dataSourceId: current.selectedDataSource.dataSourceId,
        propertyId: parseDataSourcePropertyId("status"),
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
    expect(requests[0]?.actor).toEqual({ kind: "renderer_database_management" });
    expect(authority.snapshot.commitSeq).toBe(5);
  });

  test("surfaces typed authorization failures", async () => {
    await expect(commitDatabaseManagementOperations({
      projectId,
      operationId: "operation-denied",
      buildOperations: () => [{
        kind: "delete_view",
        databaseId,
        viewId,
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
