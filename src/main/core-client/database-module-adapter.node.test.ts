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
import type { BlockRecordReadSnapshot } from "./types";
import {
  createFakeCoreHandshake,
  FakeCoreClient,
} from "./testing/fake-core-client";

const identity = {
  projectId: "project:test",
  libraryId: "library:test",
  profileId: "profile:test",
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
  contract_version: 4 as const,
  store_epoch: identity.storeEpoch,
  event_head: 17,
  value: {
    kind: "database" as const,
    value: { database: databaseRecord() },
  },
});

const emptyDataSourceWindowSnapshot = () => ({
  contract_version: 4 as const,
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
  contract_version: 4 as const,
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

const databaseBlockCommit = (
  operationId: string,
  operationKinds: readonly string[],
  commitSeq: number,
) => ({
  actor_id: "database:library:test:renderer",
  audience: { kind: "library", projectIds: [] },
  canonical_hash: "a".repeat(64),
  commit_id: `commit:${operationId}`,
  committed_at: "2026-07-20T00:00:00.000Z",
  cursor: { store_epoch: identity.storeEpoch, commit_seq: commitSeq },
  duplicate: false,
  effects: [{
    kind: "database",
    value: {
      value: { operation_count: operationKinds.length },
      receipt: {
        operation_id: operationId,
        duplicate: false,
        affected_database_ids: ["database:test"],
        affected_data_source_ids: ["source:test"],
        affected_page_ids: ["page:test"],
        affected_view_ids: ["view:test"],
        operation_kinds: [...operationKinds],
        committed_revisions: { "source:source:test": 2 },
        change_log_seq: commitSeq,
        committed_at: "2026-07-20T00:00:00.000Z",
      },
      event_sequence: commitSeq,
      store_epoch: identity.storeEpoch,
    },
  }],
  intent_hash: "b".repeat(64),
  operation_id: operationId,
  payload_completeness: "rich" as const,
  session_id: "project:project:test",
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

  test("hydrates authorized catalog entries and maps Relation candidates", async () => {
    const catalogClient = new FakeCoreClient();
    catalogClient.enqueueDatabaseRead({
      contract_version: 6,
      store_epoch: identity.storeEpoch,
      event_head: 21,
      value: {
        kind: "catalog_window",
        databases: {
          items: [{ database: databaseRecord() }],
          next_cursor: null,
          authority: { projection_revision: 21 },
        },
      },
    });
    catalogClient.enqueueDatabaseRead({
      ...emptyDataSourceWindowSnapshot(),
      event_head: 21,
      value: {
        ...emptyDataSourceWindowSnapshot().value,
        data_sources: {
          ...emptyDataSourceWindowSnapshot().value.data_sources,
          authority: { projection_revision: 21 },
        },
      },
    });
    catalogClient.enqueueDatabaseRead({
      ...emptyViewDescriptorWindowSnapshot(),
      event_head: 21,
      value: {
        ...emptyViewDescriptorWindowSnapshot().value,
        views: {
          ...emptyViewDescriptorWindowSnapshot().value.views,
          authority: { projection_revision: 21 },
        },
      },
    });
    const catalogAdapter = createCoreDatabaseModuleAdapter({
      client: catalogClient,
      ...identity,
    });
    const catalog = await catalogAdapter.read({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: identity.projectId,
      read: {
        target: { kind: "project_default" },
        mode: "catalog_window",
        window: { first: 100 },
      },
    });
    expect(catalog).toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "catalog_window",
          value: {
            databases: [{ database: { databaseId: "database:test" } }],
            nextCursor: null,
          },
        },
      },
    });

    const candidateClient = new FakeCoreClient();
    candidateClient.enqueueDatabaseRead({
      contract_version: 6,
      store_epoch: identity.storeEpoch,
      event_head: 22,
      value: {
        kind: "relation_candidate_window",
        candidates: {
          items: [{ page_id: "page:one", title: "Blocked task" }],
          next_cursor: null,
          authority: { projection_revision: 22 },
        },
      },
    });
    const candidateAdapter = createCoreDatabaseModuleAdapter({
      client: candidateClient,
      ...identity,
    });
    await expect(candidateAdapter.read({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: identity.projectId,
      read: {
        target: {
          kind: "data_source",
          dataSourceId: parseDataSourceId("source:test"),
        },
        mode: "relation_candidate_window",
        query: "blocked",
        window: { first: 25 },
      },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "relation_candidate_window",
          value: {
            candidates: [{ pageId: "page:one", title: "Blocked task" }],
          },
        },
      },
    });
    expect(candidateClient.databaseReads[0]).toMatchObject({
      mode: "relation_candidate_window",
      filter: { query: "blocked" },
      window: { first: 25 },
    });
  });

  test("maps an omitted Relation query to an unfiltered Core window", async () => {
    const client = new FakeCoreClient();
    client.enqueueDatabaseRead({
      contract_version: 6,
      store_epoch: identity.storeEpoch,
      event_head: 22,
      value: {
        kind: "relation_candidate_window",
        candidates: {
          items: [],
          next_cursor: null,
          authority: { projection_revision: 22 },
        },
      },
    });
    const adapter = createCoreDatabaseModuleAdapter({ client, ...identity });
    await adapter.read({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: identity.projectId,
      read: {
        target: {
          kind: "data_source",
          dataSourceId: parseDataSourceId("source:test"),
        },
        mode: "relation_candidate_window",
        window: { first: 25 },
      },
    });
    expect(client.databaseReads[0]).toMatchObject({
      mode: "relation_candidate_window",
      filter: null,
      window: { first: 25 },
    });
  });

  test("maps typed Property descriptors without option-window N+1 reads", async () => {
    const client = new FakeCoreClient();
    const base = {
      contract_version: 4 as const,
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
            property_id: "status",
            data_source_id: "source:test",
            name: "Status",
            schema: { kind: "select" },
            capabilities: {
              replace: true,
              patch_set_member: null,
              filter_operators: ["equals", "not_equals", "is_empty", "is_not_empty"],
              sortable: true,
              groupable: true,
            },
            option_count: 1,
            rank_key: "a",
            lifecycle: "active",
            revision: 2,
            created_at: "2026-07-25T00:00:00.000Z",
            updated_at: "2026-07-25T00:00:00.000Z",
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
            property_id: "p_abcdefgh",
            data_source_id: "source:test",
            name: "Notes",
            schema: { kind: "text" },
            capabilities: {
              replace: true,
              patch_set_member: null,
              filter_operators: ["equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty"],
              sortable: true,
              groupable: true,
            },
            option_count: 0,
            rank_key: "b",
            lifecycle: "active",
            revision: 1,
            created_at: "2026-07-25T00:00:00.000Z",
            updated_at: "2026-07-25T00:00:00.000Z",
          }],
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
                schema: { kind: "select" },
                config: {},
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
      "edit_property_values",
      "transfer_page",
      "put_view",
      "delete_view",
      "position_page",
      "position_pages",
    ] as const;
    client.enqueueBlockRecordApply(
      databaseBlockCommit("operation:test", operationKinds, 41),
    );
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
          schema: { kind: "text" },
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
          kind: "edit_property_values",
          edits: [{
            pageId: "page:test",
            dataSourceId,
            propertyId,
            edit: {
              kind: "patch_set",
              delta: {
                kind: "multi_select",
                addOptionIds: [optionId],
                removeOptionIds: [],
              },
            },
          }],
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
    expect(client.blockRecordApplies[0]).toMatchObject({
      operation_id: "operation:test",
      operation: {
        kind: "apply_database",
        intents: [
        {
          kind: "put_property",
          data_source_id: dataSourceId,
          property_id: propertyId,
          expected_data_source_revision: 1,
          expected_property_revision: 0,
          name: "Priority",
          schema: { kind: "text" },
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
          kind: "edit_property_values",
          edits: [{
            address: {
              page_id: "page:test",
              data_source_id: dataSourceId,
              property_id: propertyId,
            },
            edit: {
              kind: "patch_set",
              delta: {
                kind: "multi_select",
                add_option_ids: [optionId],
                remove_option_ids: [],
              },
            },
          }],
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
      },
    });
  });

  test("maps trusted Library writes without exposing a storage Project", async () => {
    const client = new FakeCoreClient();
    const dataSourceId = parseDataSourceId("source:library");
    const propertyId = parseDataSourcePropertyId("p_library1");
    client.enqueueBlockRecordApply(
      databaseBlockCommit("operation:library", ["put_property"], 52),
    );
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
        schema: { kind: "text" },
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
    const [result] = client.blockRecordApplies;
    expect(result).toMatchObject({
      operation_id: "operation:library",
      operation: {
        kind: "apply_database",
        intents: [{
        kind: "put_property",
        data_source_id: dataSourceId,
        property_id: propertyId,
        }],
      },
    });
    expect(result && "project_id" in result).toBe(false);
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
      identity,
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

  test("maps bounded group totals from the view_groups read", async () => {
    const client = new FakeCoreClient();
    client.enqueueDatabaseRead({
      contract_version: 4 as const,
      store_epoch: identity.storeEpoch,
      event_head: 21,
      value: {
        kind: "view_groups" as const,
        value: {
          database_id: "database:test",
          data_source_id: "source:test",
          view_id: "view:test",
          grouped: true,
          total_rows: 7,
          truncated: false,
          groups: [
            { group_key: "triage", total_rows: 4 },
            { group_key: null, total_rows: 3 },
          ],
        },
      },
    });
    client.enqueueDatabaseRead({
      contract_version: 4 as const,
      store_epoch: identity.storeEpoch,
      event_head: 21,
      value: {
        kind: "view" as const,
        value: {
          viewId: "view:test",
          databaseId: "database:test",
          dataSourceId: "source:test",
          name: "Board",
          kind: "kanban",
          config: {
            schemaKey: "nodex.database-view",
            schemaVersion: 2,
            filter: { kind: "group", operator: "and", children: [] },
            sort: [],
            group: { propertyId: "p_abcdefgh" },
            display: { propertyIds: ["p_abcdefgh"], showTitle: true },
          },
          isDefault: true,
          revision: 1,
          rankKey: "a",
          lifecycle: "active",
          createdAt: "2026-07-25T00:00:00.000Z",
          updatedAt: "2026-07-25T00:00:00.000Z",
        },
      },
    });
    client.enqueueBlockRecordRead({
      library_id: identity.libraryId,
      observed_cursor: { store_epoch: identity.storeEpoch, commit_seq: 22 },
      graph: {
        library_id: identity.libraryId,
        blocks: [{
          id: "page:canonical",
          library_id: identity.libraryId,
          kind: "page",
          lifecycle: "active",
          properties: {
            title: "Canonical",
            dataSourceValues: [{
              propertyId: "p_abcdefgh",
              value: "todo",
              revision: 3,
            }],
          },
          content_shard_id: "shard:canonical",
          revision: 4,
        }],
        placements: [{
          block_id: "page:canonical",
          parent: { kind: "data_source", id: "source:test" },
          rank_key: "a",
          revision: 2,
        }],
      },
      view_positions: [{
        view_id: "view:test",
        data_source_id: "source:test",
        block_id: "page:canonical",
        group_key: null,
        rank_key: "a",
        revision: 2,
      }],
      content: [],
    } satisfies BlockRecordReadSnapshot);
    const runtime = {
      backend: "rust",
      identity,
      rootClient: {
        handshake: createFakeCoreHandshake({
          libraryId: identity.libraryId,
          profileId: "profile:test",
          storeEpoch: identity.storeEpoch,
        }),
      },
      clientForProject: () => client,
    } as unknown as RustDataAuthorityRuntime;
    const bridge = createDesktopDatabaseModuleBridge({
      authority: Promise.resolve(runtime),
    });

    const groups = await bridge.getDatabaseViewGroups(identity.projectId, {
      databaseViewId: "view:test",
    });

    expect(client.databaseReads[0]).toMatchObject({
      mode: "view_groups",
      target: { kind: "view", view_id: "view:test" },
    });
    expect(groups).toMatchObject({
      projectId: identity.projectId,
      libraryId: identity.libraryId,
      viewId: "view:test",
      grouped: true,
      totalRows: 1,
      truncated: false,
      groups: [
        { groupKey: "todo", totalRows: 1 },
      ],
    });
    expect(groups.changeLogSeq).toBe(22);
  });

  test("overlays canonical values into row detail without replacing its body projection", async () => {
    const client = new FakeCoreClient();
    client.enqueueBlockRecordRead({
      library_id: identity.libraryId,
      observed_cursor: { store_epoch: identity.storeEpoch, commit_seq: 31 },
      graph: {
        library_id: identity.libraryId,
        blocks: [{
          id: "page:detail",
          library_id: identity.libraryId,
          kind: "page",
          lifecycle: "active",
          properties: {
            title: "Canonical title",
            dataSourceValues: [{
              propertyId: "status",
              value: "ship",
              revision: 4,
            }],
          },
          content_shard_id: "shard:detail",
          revision: 9,
        }],
        placements: [{
          block_id: "page:detail",
          parent: { kind: "data_source", id: "source:test" },
          rank_key: "a",
          revision: 3,
        }],
      },
      view_positions: [],
      content: [],
    } satisfies BlockRecordReadSnapshot);
    client.enqueueDatabaseRead({
      contract_version: 4 as const,
      store_epoch: identity.storeEpoch,
      event_head: 30,
      value: {
        kind: "row_detail" as const,
        value: {
          summary: {
            page_id: "page:detail",
            lifecycle: "active",
            title: "stale title",
            rich_title: [],
            description_preview: "stale preview",
            description_length: 13,
            has_description: true,
            database_values: {
              status: "triage",
              priority: null,
              estimate: null,
              tags: [],
              due_date: null,
              scheduled_start: null,
              scheduled_end: null,
              assignee: null,
            },
            intrinsic_properties: {
              "run.target": "localProject",
              "run.localPath": null,
              "run.baseBranch": null,
              "run.worktreePath": null,
              "run.environmentPath": null,
              "schedule.isAllDay": false,
              "schedule.timezone": null,
              "recurrence.config": null,
              "reminders.config": [],
            },
            database_value_revisions: { status: 3 },
            metadata_revision: 3,
            parent_revision: 1,
            document_id: "document:detail",
            document_generation: 1,
            document_head_seq: 1,
            membership_id: "membership:detail",
            membership_revision: 1,
            membership_created_at: "2026-08-06T00:00:00.000Z",
            created_at: "2026-08-06T00:00:00.000Z",
            updated_at: "2026-08-06T00:00:00.000Z",
            effective_group_key: "triage",
            rank_key: "a",
            position_revision: 1,
            position_order: 0,
          },
          body_nfm: "old body projection",
        },
      },
    });
    const runtime = {
      backend: "rust",
      identity,
      rootClient: {
        handshake: createFakeCoreHandshake({
          libraryId: identity.libraryId,
          profileId: identity.profileId,
          storeEpoch: identity.storeEpoch,
        }),
      },
      clientForProject: () => client,
    } as unknown as RustDataAuthorityRuntime;
    const bridge = createDesktopDatabaseModuleBridge({
      authority: Promise.resolve(runtime),
    });

    await expect(bridge.getDatabaseRowPage(
      identity.projectId,
      "page:detail",
    )).resolves.toMatchObject({
      id: "page:detail",
      title: "Canonical title",
      status: "ship",
      revision: 9,
      description: "old body projection",
    });
  });

  test("passes a window group scope through to the Core read", async () => {
    const client = new FakeCoreClient();
    // A wrong-kind response makes the helper throw after the Core read has
    // been issued, which is all this passthrough assertion needs.
    client.enqueueDatabaseRead(databaseSnapshot());
    const runtime = {
      backend: "rust",
      identity,
      rootClient: {
        handshake: createFakeCoreHandshake({
          libraryId: identity.libraryId,
          profileId: "profile:test",
          storeEpoch: identity.storeEpoch,
        }),
      },
      clientForProject: () => client,
    } as unknown as RustDataAuthorityRuntime;
    const bridge = createDesktopDatabaseModuleBridge({
      authority: Promise.resolve(runtime),
    });

    await expect(
      bridge.getDatabaseViewWindow(identity.projectId, {
        databaseViewId: "view:test",
        first: 25,
        groupScope: { kind: "key", key: "triage" },
      }),
    ).rejects.toThrow("non-window");

    expect(client.databaseReads[0]).toMatchObject({
      mode: "view_window",
      window: { first: 25 },
      group_scope: { kind: "key", key: "triage" },
    });
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
