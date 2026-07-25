import { describe, expect, test } from "vitest";

import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../../shared/database-module-v2";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import {
  createCoreDatabaseModuleAdapter,
  createCoreLibraryDatabaseModuleAdapter,
} from "./database-module-adapter";
import {
  createDesktopDatabaseModuleBridge,
  mapCoreDatabaseEvent,
  mapCoreLibraryDatabaseEvent,
} from "./desktop-database-module-bridge";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import {
  createFakeCoreHandshake,
  FakeCoreClient,
} from "./testing/fake-core-client";

const identity = {
  projectId: "project:test",
  libraryId: "library:test",
  storeEpoch: "epoch:test",
} as const;

const databaseRecord = () => ({
  databaseId: "database:test",
  libraryId: identity.libraryId,
  name: "Tasks",
  lifecycle: "active",
  defaultViewId: null,
  accessRevision: 1,
  metadataRevision: 1,
  createdAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:00:00.000Z",
});

const databaseSnapshot = () => ({
  contract_version: 3 as const,
  store_epoch: identity.storeEpoch,
  event_head: 17,
  value: {
    kind: "database" as const,
    value: { database: databaseRecord() },
  },
});

const emptyDataSourceWindowSnapshot = () => ({
  contract_version: 3 as const,
  store_epoch: identity.storeEpoch,
  event_head: 17,
  value: {
    kind: "data_source_window" as const,
    data_sources: {
      items: [],
      next_cursor: null,
      authority: { projection_revision: 17 },
    },
  },
});

const emptyViewDescriptorWindowSnapshot = () => ({
  contract_version: 3 as const,
  store_epoch: identity.storeEpoch,
  event_head: 17,
  value: {
    kind: "view_descriptor_window" as const,
    views: {
      items: [],
      next_cursor: null,
      authority: { projection_revision: 17 },
    },
  },
});

describe("Core Database Module Adapter", () => {
  test("maps the Project-bound read and validates the shared v2 snapshot", async () => {
    const client = new FakeCoreClient();
    client.enqueueDatabaseRead(databaseSnapshot());
    client.enqueueDatabaseRead(emptyDataSourceWindowSnapshot());
    client.enqueueDatabaseRead(emptyViewDescriptorWindowSnapshot());
    const adapter = createCoreDatabaseModuleAdapter({ client, ...identity });

    await expect(adapter.read({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: identity.projectId,
      read: { target: { kind: "project_default" }, mode: "database" },
    })).resolves.toEqual({
      ok: true,
      value: {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: identity.projectId,
        libraryId: identity.libraryId,
        storeEpoch: identity.storeEpoch,
        changeLogSeq: 17,
        value: {
          kind: "database",
          value: {
            database: databaseRecord(),
            dataSources: [],
            views: [],
          },
        },
      },
    });
    expect(client.databaseReads).toEqual([{
      target: { kind: "project_default" },
      mode: "database",
      filter: null,
      sort: null,
    }, {
      target: { kind: "database", database_id: "database:test" },
      mode: "data_source_window",
      filter: null,
      sort: null,
      page_ids: null,
      window: { after: null, first: 200 },
    }, {
      target: { kind: "database", database_id: "database:test" },
      mode: "view_descriptor_window",
      filter: null,
      sort: null,
      page_ids: null,
      window: { after: null, first: 200 },
    }]);
  });

  test("assembles legacy Property options only from bounded Core windows", async () => {
    const client = new FakeCoreClient();
    const base = {
      contract_version: 3 as const,
      store_epoch: identity.storeEpoch,
      event_head: 19,
    };
    client.enqueueDatabaseRead({
      ...base,
      value: {
        kind: "data_source" as const,
        value: {
          dataSource: {
            dataSourceId: "source:test",
            libraryId: identity.libraryId,
            homeDatabaseId: "database:test",
            name: "Tasks",
            schemaKey: "nodex.database",
            schemaRevision: 2,
            lifecycle: "active",
            rankKey: "a",
            createdAt: "2026-07-25T00:00:00.000Z",
            updatedAt: "2026-07-25T00:00:00.000Z",
          },
        },
      },
    });
    client.enqueueDatabaseRead({
      ...base,
      value: {
        kind: "property_window" as const,
        properties: {
          items: [{
            propertyId: "status",
            dataSourceId: "source:test",
            name: "Status",
            valueType: "select",
            config: { options: [] },
            optionCount: 1,
            rankKey: "a",
            lifecycle: "active",
            revision: 2,
            createdAt: "2026-07-25T00:00:00.000Z",
            updatedAt: "2026-07-25T00:00:00.000Z",
          }],
          next_cursor: "property:next",
          authority: { projection_revision: 19 },
        },
      },
    });
    client.enqueueDatabaseRead({
      ...base,
      value: {
        kind: "property_window" as const,
        properties: {
          items: [{
            propertyId: "p_abcdefgh",
            dataSourceId: "source:test",
            name: "Notes",
            valueType: "text",
            config: {},
            optionCount: 0,
            rankKey: "b",
            lifecycle: "active",
            revision: 1,
            createdAt: "2026-07-25T00:00:00.000Z",
            updatedAt: "2026-07-25T00:00:00.000Z",
          }],
          next_cursor: null,
          authority: { projection_revision: 19 },
        },
      },
    });
    client.enqueueDatabaseRead({
      ...base,
      value: {
        kind: "option_window" as const,
        options: {
          items: [{ id: "build", name: "Build", color: "green" }],
          next_cursor: null,
          authority: { projection_revision: 19 },
        },
      },
    });
    const adapter = createCoreDatabaseModuleAdapter({ client, ...identity });

    const result = await adapter.read({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: identity.projectId,
      read: {
        target: {
          kind: "data_source",
          dataSourceId: parseDataSourceId("source:test"),
        },
        mode: "data_source",
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result).toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "data_source",
          value: {
            properties: [
              {
                propertyId: "status",
                config: { options: [{ id: "build" }] },
              },
              { propertyId: "p_abcdefgh", config: {} },
            ],
          },
        },
      },
    });
    expect(client.databaseReads.map((read) => read.mode)).toEqual([
      "data_source",
      "property_window",
      "property_window",
      "option_window",
    ]);
  });

  test("maps ordered mutation semantics and validates the atomic Core receipt", async () => {
    const client = new FakeCoreClient();
    const databaseId = parseDatabaseId("database:test");
    const dataSourceId = parseDataSourceId("source:test");
    const propertyId = parseDataSourcePropertyId("p_abcdefgh");
    const optionId = parseDataSourceOptionId({
      propertyId,
      value: "o_abcdefgh",
    });
    const viewId = parseDatabaseViewId("view:test");
    const config = {
      schemaKey: "nodex.database-view" as const,
      schemaVersion: 2 as const,
      filter: { kind: "group" as const, operator: "and" as const, children: [] },
      sort: [{
        field: { kind: "manual" as const },
        direction: "asc" as const,
        nulls: "last" as const,
      }],
      group: null,
      display: { propertyIds: [propertyId], showTitle: true },
    };
    const operationKinds = [
      "put_property",
      "delete_property",
      "put_option",
      "delete_option",
      "set_value",
      "set_values",
      "add_remove_value",
      "transfer_page",
      "put_view",
      "delete_view",
      "position_page",
      "position_pages",
    ] as const;
    client.enqueueDatabaseApply({
      value: { operation_count: operationKinds.length },
      receipt: {
        operation_id: "operation:test",
        duplicate: false,
        affected_database_ids: [databaseId],
        affected_data_source_ids: [dataSourceId],
        affected_page_ids: ["page:test"],
        affected_view_ids: [viewId],
        operation_kinds: operationKinds,
        committed_revisions: { [`source:${dataSourceId}`]: 2 },
        change_log_seq: 41,
        committed_at: "2026-07-20T00:00:00.000Z",
      },
      event_sequence: 41,
      store_epoch: identity.storeEpoch,
    });
    const adapter = createCoreDatabaseModuleAdapter({ client, ...identity });

    await expect(adapter.apply({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: "operation:test",
      projectId: identity.projectId,
      storeEpoch: identity.storeEpoch,
      actor: { kind: "electron_renderer", clientId: "renderer:test" },
      operations: [
        {
          kind: "put_property",
          dataSourceId,
          propertyId,
          expectedDataSourceRevision: 1,
          expectedPropertyRevision: 0,
          name: "Priority",
          valueType: "text",
          config: {},
          beforePropertyId: propertyId,
        },
        {
          kind: "delete_property",
          dataSourceId,
          propertyId,
          expectedDataSourceRevision: 2,
          expectedPropertyRevision: 1,
        },
        {
          kind: "put_option",
          dataSourceId,
          propertyId,
          optionId,
          name: "High",
          color: "red",
          expectedPropertyRevision: 1,
        },
        {
          kind: "delete_option",
          dataSourceId,
          propertyId,
          optionId,
          expectedPropertyRevision: 2,
        },
        {
          kind: "set_value",
          pageId: "page:test",
          dataSourceId,
          propertyId,
          expectedValueRevision: 0,
          value: { nested: ["preserved"] },
        },
        {
          kind: "set_values",
          values: [{
            pageId: "page:test",
            dataSourceId,
            propertyId,
            expectedValueRevision: 1,
            value: null,
          }],
        },
        {
          kind: "add_remove_value",
          pageId: "page:test",
          dataSourceId,
          propertyId,
          add: [optionId],
          remove: [],
        },
        {
          kind: "transfer_page",
          pageId: "page:test",
          expectedParentRevision: 1,
          expectedActiveMembershipRevision: 1,
          target: { kind: "data_source", dataSourceId },
        },
        {
          kind: "put_view",
          databaseId,
          dataSourceId,
          viewId,
          expectedRevision: 0,
          name: "Priority",
          viewKind: "list",
          config,
          isDefault: true,
          beforeViewId: null,
        },
        {
          kind: "delete_view",
          databaseId,
          viewId,
          expectedRevision: 1,
        },
        {
          kind: "position_page",
          viewId,
          pageId: "page:test",
          expectedPositionRevision: 0,
          groupKey: null,
          beforePageId: "page:anchor",
        },
        {
          kind: "position_pages",
          viewId,
          pages: [{ pageId: "page:test", expectedPositionRevision: 1 }],
          groupKey: "high",
        },
      ],
    })).resolves.toEqual({
      ok: true,
      value: {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        operationId: "operation:test",
        projectId: identity.projectId,
        libraryId: identity.libraryId,
        storeEpoch: identity.storeEpoch,
        duplicate: false,
        operationKinds,
        affectedDatabaseIds: [databaseId],
        affectedDataSourceIds: [dataSourceId],
        affectedPageIds: ["page:test"],
        affectedViewIds: [viewId],
        committedRevisions: { [`source:${dataSourceId}`]: 2 },
        changeLogSeq: 41,
        committedAt: "2026-07-20T00:00:00.000Z",
      },
    });
    expect(client.databaseApplies).toEqual([{
      operationId: "operation:test",
      intent: [
        {
          kind: "put_property",
          data_source_id: dataSourceId,
          property_id: propertyId,
          expected_data_source_revision: 1,
          expected_property_revision: 0,
          name: "Priority",
          value_type: "text",
          before_property_id: propertyId,
        },
        {
          kind: "delete_property",
          data_source_id: dataSourceId,
          property_id: propertyId,
          expected_data_source_revision: 2,
          expected_property_revision: 1,
        },
        {
          kind: "put_option",
          data_source_id: dataSourceId,
          property_id: propertyId,
          option_id: optionId,
          name: "High",
          color: "red",
          expected_property_revision: 1,
        },
        {
          kind: "delete_option",
          data_source_id: dataSourceId,
          property_id: propertyId,
          option_id: optionId,
          expected_property_revision: 2,
        },
        {
          kind: "set_value",
          page_id: "page:test",
          data_source_id: dataSourceId,
          property_id: propertyId,
          expected_value_revision: 0,
          value: { nested: ["preserved"] },
        },
        {
          kind: "set_values",
          values: [{
            page_id: "page:test",
            data_source_id: dataSourceId,
            property_id: propertyId,
            expected_value_revision: 1,
            value: null,
          }],
        },
        {
          kind: "add_remove_value",
          page_id: "page:test",
          data_source_id: dataSourceId,
          property_id: propertyId,
          add: [optionId],
          remove: [],
        },
        {
          kind: "transfer_page",
          page_id: "page:test",
          expected_parent_revision: 1,
          expected_active_membership_revision: 1,
          target: { kind: "data_source", data_source_id: dataSourceId },
        },
        {
          kind: "put_view",
          database_id: databaseId,
          data_source_id: dataSourceId,
          view_id: viewId,
          expected_revision: 0,
          name: "Priority",
          view_kind: "list",
          config,
          is_default: true,
          before_view_id: null,
        },
        {
          kind: "delete_view",
          database_id: databaseId,
          view_id: viewId,
          expected_revision: 1,
        },
        {
          kind: "position_page",
          view_id: viewId,
          page_id: "page:test",
          expected_position_revision: 0,
          group_key: null,
          before_page_id: "page:anchor",
        },
        {
          kind: "position_pages",
          view_id: viewId,
          pages: [{ page_id: "page:test", expected_position_revision: 1 }],
          group_key: "high",
          before_page_id: null,
        },
      ],
    }]);
  });

  test("maps trusted Library writes without exposing a storage Project", async () => {
    const client = new FakeCoreClient();
    const dataSourceId = parseDataSourceId("source:library");
    const propertyId = parseDataSourcePropertyId("p_library1");
    client.enqueueDatabaseApply({
      value: { operation_count: 1 },
      receipt: {
        operation_id: "operation:library",
        duplicate: false,
        affected_database_ids: [],
        affected_data_source_ids: [dataSourceId],
        affected_page_ids: [],
        affected_view_ids: [],
        operation_kinds: ["put_property"],
        committed_revisions: {
          [`property:${dataSourceId}:${propertyId}`]: 1,
        },
        change_log_seq: 52,
        committed_at: "2026-07-20T00:10:00.000Z",
      },
      event_sequence: 52,
      store_epoch: identity.storeEpoch,
    });
    const adapter = createCoreLibraryDatabaseModuleAdapter({
      client,
      libraryId: identity.libraryId,
      storeEpoch: identity.storeEpoch,
    });

    await expect(adapter.apply({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: "operation:library",
      storeEpoch: identity.storeEpoch,
      operations: [{
        kind: "put_property",
        dataSourceId,
        propertyId,
        expectedDataSourceRevision: 1,
        expectedPropertyRevision: 0,
        name: "Library",
        valueType: "text",
        config: {},
      }],
    })).resolves.toMatchObject({
      ok: true,
      value: {
        accessContext: { kind: "library" },
        libraryId: identity.libraryId,
        operationId: "operation:library",
        operationKinds: ["put_property"],
      },
    });
    const [result] = client.databaseApplies;
    expect(result).toMatchObject({
      operationId: "operation:library",
      intent: [{
        kind: "put_property",
        data_source_id: dataSourceId,
        property_id: propertyId,
      }],
    });
    expect(result && "projectId" in result).toBe(false);
  });

  test("selects one cached Core client for each Project", async () => {
    const client = new FakeCoreClient();
    for (let index = 0; index < 2; index += 1) {
      client.enqueueDatabaseRead(databaseSnapshot());
      client.enqueueDatabaseRead(emptyDataSourceWindowSnapshot());
      client.enqueueDatabaseRead(emptyViewDescriptorWindowSnapshot());
    }
    const requestedProjects: string[] = [];
    const runtime = {
      backend: "rust",
      rootClient: {
        handshake: createFakeCoreHandshake({
          libraryId: identity.libraryId,
          profileId: "profile:test",
          storeEpoch: identity.storeEpoch,
        }),
      },
      clientForProject: (projectId: string) => {
        requestedProjects.push(projectId);
        return client;
      },
    } as unknown as RustDataAuthorityRuntime;
    const bridge = createDesktopDatabaseModuleBridge({
      authority: Promise.resolve(runtime),
    });
    const request = {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: identity.projectId,
      read: {
        target: { kind: "project_default" as const },
        mode: "database" as const,
      },
    };

    await expect(bridge.read(request)).resolves.toMatchObject({ ok: true });
    await expect(bridge.read(request)).resolves.toMatchObject({ ok: true });
    expect(requestedProjects).toEqual([identity.projectId]);
  });

  test("maps Database Core events into resource-scoped renderer invalidations", () => {
    expect(mapCoreDatabaseEvent({
      transport_version: 4,
      event: {
        event_version: 2,
        sequence: 42,
        store_epoch: identity.storeEpoch,
        operation_id: "operation:database",
        committed_at: "2026-07-20T00:00:00.000Z",
        projection_impact: { kind: "none" },
        payload: {
          module: "database",
          event: {
            kind: "database_changed",
            project_id: identity.projectId,
            database_ids: ["database:test"],
            data_source_ids: ["source:test"],
            page_ids: ["page:test"],
            view_ids: ["view:test"],
          },
        },
      },
    }, identity.libraryId)).toEqual({
      version: 2,
      projectId: identity.projectId,
      libraryId: identity.libraryId,
      storeEpoch: identity.storeEpoch,
      operationId: "operation:database",
      sourceKind: "database_module",
      affectedDatabaseIds: ["database:test"],
      affectedDataSourceIds: ["source:test"],
      affectedPageIds: ["page:test"],
      affectedViewIds: ["view:test"],
      changeLogSeq: 42,
    });
  });

  test("maps Library Database events without a compatibility Project", () => {
    expect(mapCoreLibraryDatabaseEvent({
      transport_version: 4,
      event: {
        event_version: 2,
        sequence: 53,
        store_epoch: identity.storeEpoch,
        operation_id: "operation:library-database",
        committed_at: "2026-07-20T00:11:00.000Z",
        projection_impact: { kind: "none" },
        payload: {
          module: "database",
          event: {
            kind: "database_changed",
            project_id: null,
            database_ids: ["database:library"],
            data_source_ids: ["source:library"],
            page_ids: ["page:library"],
            view_ids: ["view:library"],
          },
        },
      },
    }, identity.libraryId)).toEqual({
      version: 1,
      libraryId: identity.libraryId,
      storeEpoch: identity.storeEpoch,
      changeLogSeq: 53,
      changeKind: "database",
      affectedParentKeys: [
        "library",
        "catalog",
        "database:database:library",
      ],
      affectedPageIds: ["page:library"],
      affectedDatabaseIds: ["database:library"],
      affectedViewIds: ["view:library"],
    });
  });
});
