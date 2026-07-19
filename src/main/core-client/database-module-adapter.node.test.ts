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
import { FakeCoreClient } from "./testing/fake-core-client";

const identity = {
  projectId: "project:test",
  libraryId: "library:test",
  storeEpoch: "epoch:test",
} as const;

const emptyCatalogSnapshot = () => ({
  version: 1 as const,
  store_epoch: identity.storeEpoch,
  event_head: 17,
  value: { kind: "catalog" as const, databases: [] },
});

describe("Core Database Module Adapter", () => {
  test("maps the Project-bound read and validates the shared v2 snapshot", async () => {
    const client = new FakeCoreClient();
    client.enqueueDatabaseRead(emptyCatalogSnapshot());
    const adapter = createCoreDatabaseModuleAdapter({ client, ...identity });

    await expect(adapter.read({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: identity.projectId,
      read: { target: { kind: "project_default" }, mode: "catalog" },
    })).resolves.toEqual({
      ok: true,
      value: {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: identity.projectId,
        libraryId: identity.libraryId,
        storeEpoch: identity.storeEpoch,
        changeLogSeq: 17,
        value: { kind: "catalog", databases: [] },
      },
    });
    expect(client.databaseReads).toEqual([{
      target: { kind: "project_default" },
      mode: "catalog",
      filter: undefined,
      sort: null,
    }]);
  });

  test("preserves filter JSON while translating only typed target fields", async () => {
    const client = new FakeCoreClient();
    client.enqueueDatabaseRead(emptyCatalogSnapshot());
    const adapter = createCoreDatabaseModuleAdapter({ client, ...identity });
    const filter = {
      kind: "clause" as const,
      propertyId: "p_status",
      operator: "equals" as const,
      value: "done",
    };
    const sort = [{
      field: { kind: "property" as const, propertyId: "p_status" },
      direction: "asc" as const,
      nulls: "last" as const,
    }];

    await adapter.read({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: identity.projectId,
      read: {
        target: {
          kind: "data_source",
          dataSourceId: parseDataSourceId("source:test"),
        },
        mode: "query",
        filter,
        sort,
      },
    });

    expect(client.databaseReads).toEqual([{
      target: { kind: "data_source", data_source_id: "source:test" },
      mode: "query",
      filter,
      sort,
    }]);
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
    client.enqueueDatabaseRead(emptyCatalogSnapshot());
    client.enqueueDatabaseRead(emptyCatalogSnapshot());
    const requestedProjects: string[] = [];
    const runtime = {
      backend: "rust",
      rootClient: {
        handshake: {
          library_id: identity.libraryId,
          profile_id: "profile:test",
          store_epoch: identity.storeEpoch,
        },
      },
      clientForProject: (projectId: string) => {
        requestedProjects.push(projectId);
        return client;
      },
    } as unknown as RustDataAuthorityRuntime;
    const bridge = createDesktopDatabaseModuleBridge({
      authority: Promise.resolve(runtime),
      typescript: {
        read: async () => {
          throw new Error("TypeScript Database read must not run");
        },
        apply: async () => {
          throw new Error("TypeScript Database apply must not run");
        },
        readLibrary: async () => {
          throw new Error("TypeScript Library Database read must not run");
        },
        applyLibrary: async () => {
          throw new Error("TypeScript Library Database apply must not run");
        },
      },
    });
    const request = {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: identity.projectId,
      read: { target: { kind: "project_default" as const }, mode: "catalog" as const },
    };

    await expect(bridge.read(request)).resolves.toMatchObject({ ok: true });
    await expect(bridge.read(request)).resolves.toMatchObject({ ok: true });
    expect(requestedProjects).toEqual([identity.projectId]);
  });

  test("maps Database Core events into resource-scoped renderer invalidations", () => {
    expect(mapCoreDatabaseEvent({
      protocol_version: 1,
      event: {
        version: 1,
        sequence: 42,
        store_epoch: identity.storeEpoch,
        operation_id: "operation:database",
        committed_at: "2026-07-20T00:00:00.000Z",
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
      protocol_version: 1,
      event: {
        version: 1,
        sequence: 53,
        store_epoch: identity.storeEpoch,
        operation_id: "operation:library-database",
        committed_at: "2026-07-20T00:11:00.000Z",
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
