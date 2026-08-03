import { describe, expect, test } from "vitest";

import {
  plainTextToPortableRichText,
  primaryCanvasBlockId,
} from "../../shared/block-documents";
import type { BlockPropertyMutationRequestV2 } from "../../shared/block-property-mutations-v2";
import {
  parseDataSourceId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import { LIBRARY_NAVIGATION_EVENT_VERSION } from "../../shared/library-events";
import { LIBRARY_MODULE_CONTRACT_VERSION } from "../../shared/library-module";
import { PAGE_HISTORY_CONTRACT_VERSION } from "../../shared/page-history";
import type { PageLifecycleMutationRequestV2 } from "../../shared/page-lifecycle-v2";
import {
  createFakeCoreHandshake,
  FakeCoreClient,
} from "./testing/fake-core-client";
import { createCoreLibraryModuleAdapter } from "./library-module-adapter";
import {
  createDesktopLibraryModuleBridge,
  mapCoreLibraryEvent,
} from "./desktop-library-module-bridge";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";

const identity = {
  libraryId: "library:test",
  profileId: "profile:test",
  storeEpoch: "epoch:test",
} as const;

const fakeHandshake = () => createFakeCoreHandshake(identity);

const pageDetailSnapshot = () => ({
  contract_version: 2 as const,
  store_epoch: identity.storeEpoch,
  event_head: 9,
  value: {
    kind: "page_detail" as const,
    value: {
      version: 2,
      library_id: identity.libraryId,
      store_epoch: identity.storeEpoch,
      change_log_seq: 9,
      page: {
        pageId: "page:one",
        libraryId: identity.libraryId,
        parent: { kind: "library", libraryId: identity.libraryId },
        lifecycle: "active",
        parentRevision: 1,
        metadataRevision: 1,
        documentId: "document:one",
        documentGeneration: 1,
        documentHeadSeq: 1,
        title: "Page One",
        richTitle: plainTextToPortableRichText("Page One"),
        preview: "",
        plainText: "",
        createdAt: "2026-07-19T18:00:00.000Z",
        updatedAt: "2026-07-19T18:00:00.000Z",
      },
      document: {
        readiness: "ready",
        schema_key: "nodex.page",
        schema_version: 1,
      },
      intrinsic_properties: [{
        key: "description",
        value_type: "string",
        value: null,
        revision: 1,
      }],
      data_source_context: { kind: "standalone" as const },
      access_context: { kind: "library" as const },
    },
  },
});

const pageHistorySnapshot = () => ({
  contract_version: 2 as const,
  store_epoch: identity.storeEpoch,
  event_head: 12,
  value: {
    kind: "page_history" as const,
    value: {
      version: PAGE_HISTORY_CONTRACT_VERSION,
      library_id: identity.libraryId,
      page_id: "page:one",
      document_id: "document:one",
      entries: [{
        id: "change:12",
        kind: "block_mutation" as const,
        library_id: identity.libraryId,
        page_id: "page:one",
        document_id: "document:one",
        occurred_at: "2026-07-19T18:12:00.000Z",
        display: {
          category: "content" as const,
          title: "Edited page content",
          detail: null,
          actor_label: "Electron renderer",
        },
        evidence: { status: "verified" as const },
        recovery: {
          kind: "unavailable" as const,
          reason: "no_inverse_contract" as const,
        },
        change_seq: 12,
        mutation_id: "mutation:12",
        mutation_kind: "semantic_mutation",
        affected_block_count: 1,
        field_intent_count: 2,
      }],
      next_cursor: {
        occurred_at: "2026-07-19T18:12:00.000Z",
        source: "change_log" as const,
        change_seq: 12,
      },
    },
  },
});

const projectPageSearchSnapshot = () => ({
  contract_version: 2 as const,
  store_epoch: identity.storeEpoch,
  event_head: 13,
  value: {
    kind: "project_page_search" as const,
    items: [{
      project_id: "project:test",
      page_id: "page:one",
      title: "Page One",
      status: "build" as const,
      score: 1_000_000,
      excerpt: "Page search evidence",
    }],
  },
});

const pageTargetSnapshot = () => ({
  contract_version: 2 as const,
  store_epoch: identity.storeEpoch,
  event_head: 14,
  value: {
    kind: "page_target" as const,
    value: {
      status: "available" as const,
      target_page_id: "page:one",
      page: pageDetailSnapshot().value.value.page,
      document: {
        readiness: "ready",
        schema_key: "nodex.page",
        schema_version: 1,
      },
    },
  },
});

const pageOwnershipPathSnapshot = () => ({
  contract_version: 2 as const,
  store_epoch: identity.storeEpoch,
  event_head: 14,
  value: {
    kind: "page_ownership_path" as const,
    value: {
      status: "available" as const,
      target_page_id: "page:one",
      ancestors: [{
        page_id: "page:root",
        title: "Root",
        lifecycle: "active" as const,
      }],
    },
  },
});

const pageLocationSnapshot = () => ({
  contract_version: 2 as const,
  store_epoch: identity.storeEpoch,
  event_head: 14,
  value: {
    kind: "page_location" as const,
    value: { page_id: "page:one", project_id: "project:test" },
  },
});

const viewLocationSnapshot = () => ({
  contract_version: 4 as const,
  store_epoch: identity.storeEpoch,
  event_head: 14,
  value: {
    kind: "view_location" as const,
    value: {
      view_id: "view:test",
      data_source_id: "source:test",
      database_id: "database:test",
      project_id: "project:test",
    },
  },
});

const lifecycleTagsProperty = () => ({
  propertyId: "tags",
  dataSourceId: "source:test",
  name: "Tags",
  valueType: "multi_select",
  config: { options: [] },
  rankKey: "b",
  lifecycle: "active",
  revision: 1,
  createdAt: "2026-07-19T18:00:00.000Z",
  updatedAt: "2026-07-19T18:00:00.000Z",
});

const lifecycleDefaultView = () => ({
  database: {
    databaseId: "database:test",
    libraryId: identity.libraryId,
    name: "Tasks",
    lifecycle: "active",
    defaultViewId: "view:test",
    accessRevision: 1,
    metadataRevision: 1,
    createdAt: "2026-07-19T18:00:00.000Z",
    updatedAt: "2026-07-19T18:00:00.000Z",
  },
  dataSource: {
    dataSourceId: "source:test",
    libraryId: identity.libraryId,
    homeDatabaseId: "database:test",
    name: "Tasks",
    schemaKey: "nodex.database",
    schemaRevision: 1,
    lifecycle: "active",
    rankKey: "a",
    createdAt: "2026-07-19T18:00:00.000Z",
    updatedAt: "2026-07-19T18:00:00.000Z",
  },
  view: {
    viewId: "view:test",
    databaseId: "database:test",
    dataSourceId: "source:test",
    name: "All",
    kind: "list",
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
      display: { propertyIds: ["tags"], showTitle: true },
    },
    isDefault: true,
    revision: 1,
    rankKey: "a",
    lifecycle: "active",
    createdAt: "2026-07-19T18:00:00.000Z",
    updatedAt: "2026-07-19T18:00:00.000Z",
  },
  properties: [lifecycleTagsProperty()],
  rows: [],
});

const pageLifecyclePreflightSnapshot = () => ({
  contract_version: 2 as const,
  store_epoch: identity.storeEpoch,
  event_head: 15,
  value: {
    kind: "page_lifecycle_preflight" as const,
    value: {
      version: 2,
      default_view: lifecycleDefaultView(),
      tags_property: lifecycleTagsProperty(),
      reserved_block_type: null,
      page: {
        page_id: "page:one",
        lifecycle: "active",
        parent: { kind: "data_source" as const, data_source_id: "source:test" },
        library_rank_key: null,
        metadata_revision: 3,
        parent_revision: 2,
        document: {
          document_id: "document:one",
          generation: 1,
          head_seq: 4,
          readiness: "ready",
          authority: "ydoc_primary",
          schema_key: "nodex.page",
          schema_version: 2,
        },
        membership: {
          membership_id: "membership:one",
          database_id: "database:test",
          data_source_id: "source:test",
          membership_revision: 1,
          view_id: "view:test",
          view_revision: 2,
          status_property_id: "status",
          status_value_revision: 1,
          status: "build" as const,
          position: {
            group_key: "build",
            rank_key: "a",
            revision: 1,
          },
        },
        restore_evidence: null,
      },
    },
  },
});

describe("Core Library Module Adapter", () => {
  test("maps strict Project and Library Page Detail snapshots", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });
    client.enqueueRead(pageDetailSnapshot());

    await expect(adapter.readProjectPageDetail(
      "project:test",
      "page:one",
    )).resolves.toMatchObject({
      ok: true,
      value: {
        projectId: "project:test",
        libraryId: identity.libraryId,
        changeLogSeq: 9,
        page: { pageId: "page:one", title: "Page One" },
        intrinsicProperties: [{
          key: "description",
          valueType: "string",
          value: null,
        }],
        dataSourceContext: { kind: "standalone" },
      },
    });

    client.enqueueRead(pageDetailSnapshot());
    const libraryDetail = await adapter.readLibraryPageDetail("page:one");
    expect(libraryDetail).toMatchObject({
      ok: true,
      value: {
        accessContext: { kind: "library" },
        libraryId: identity.libraryId,
        page: { pageId: "page:one" },
      },
    });
    if (!libraryDetail.ok) throw new Error("Expected Library Page Detail");
    expect("projectId" in libraryDetail.value).toBe(false);
    expect(client.reads).toEqual([
      { kind: "page_detail", page_id: "page:one" },
      { kind: "page_detail", page_id: "page:one" },
    ]);
  });

  test("selects the Project client or trusted root client for Page Detail", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    rootClient.enqueueRead(pageDetailSnapshot());
    projectClient.enqueueRead(pageDetailSnapshot());
    projectClient.enqueueRead(pageHistorySnapshot());
    const requestedProjects: string[] = [];
    const runtime = {
      backend: "rust",
      identity,
      rootClient: Object.assign(rootClient, {
        handshake: fakeHandshake(),
      }),
      clientForProject: (projectId: string) => {
        requestedProjects.push(projectId);
        return projectClient;
      },
    } as unknown as RustDataAuthorityRuntime;
    const bridge = createDesktopLibraryModuleBridge({
      authority: Promise.resolve(runtime),
    });

    await expect(bridge.readProjectPageDetail(
      "project:test",
      "page:one",
    )).resolves.toMatchObject({
      ok: true,
      value: { projectId: "project:test", page: { pageId: "page:one" } },
    });
    await expect(bridge.readLibraryPageDetail("page:one")).resolves
      .toMatchObject({
        ok: true,
        value: {
          accessContext: { kind: "library" },
          page: { pageId: "page:one" },
        },
      });
    await expect(bridge.listPageHistory({
      version: PAGE_HISTORY_CONTRACT_VERSION,
      requestingProjectId: "project:test",
      pageId: "page:one",
    })).resolves.toMatchObject({
      ok: true,
      value: {
        libraryId: identity.libraryId,
        pageId: "page:one",
        entries: [{ kind: "block_mutation", changeSeq: 12 }],
      },
    });
    expect(requestedProjects).toEqual(["project:test"]);
    expect(projectClient.reads).toHaveLength(2);
    expect(rootClient.reads).toHaveLength(1);
  });

  test("maps Page history cursors and entries through the strict shared contract", async () => {
    const client = new FakeCoreClient();
    client.enqueueRead(pageHistorySnapshot());
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.listPageHistory({
      version: PAGE_HISTORY_CONTRACT_VERSION,
      requestingProjectId: "project:test",
      pageId: "page:one",
      before: {
        occurredAt: "2026-07-19T18:13:00.000Z",
        source: "document_version",
        versionId: "version:13",
      },
      pageSize: 25,
    })).resolves.toEqual({
      ok: true,
      value: {
        version: PAGE_HISTORY_CONTRACT_VERSION,
        libraryId: identity.libraryId,
        pageId: "page:one",
        documentId: "document:one",
        entries: [{
          id: "change:12",
          kind: "block_mutation",
          libraryId: identity.libraryId,
          pageId: "page:one",
          documentId: "document:one",
          occurredAt: "2026-07-19T18:12:00.000Z",
          display: {
            category: "content",
            title: "Edited page content",
            detail: null,
            actorLabel: "Electron renderer",
          },
          evidence: { status: "verified" },
          recovery: { kind: "unavailable", reason: "no_inverse_contract" },
          changeSeq: 12,
          mutationId: "mutation:12",
          mutationKind: "semantic_mutation",
          affectedBlockCount: 1,
          fieldIntentCount: 2,
        }],
        nextCursor: {
          occurredAt: "2026-07-19T18:12:00.000Z",
          source: "change_log",
          changeSeq: 12,
        },
      },
    });
    expect(client.reads).toEqual([{
      kind: "page_history",
      page_id: "page:one",
      before: {
        occurred_at: "2026-07-19T18:13:00.000Z",
        source: "document_version",
        version_id: "version:13",
      },
      limit: 25,
    }]);
  });

  test("maps Project-scoped Page references and trusted root locations", async () => {
    const client = new FakeCoreClient();
    client.enqueueRead(pageTargetSnapshot());
    client.enqueueRead(pageOwnershipPathSnapshot());
    client.enqueueRead(pageLocationSnapshot());
    client.enqueueRead(viewLocationSnapshot());
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.resolvePageTarget({
      requestingProjectId: "project:test",
      targetPageId: "page:one",
    })).resolves.toMatchObject({
      status: "available",
      targetPageId: "page:one",
      page: { pageId: "page:one", lifecycle: "active" },
      document: { readiness: "ready", schemaKey: "nodex.page" },
    });
    await expect(adapter.resolvePageOwnershipPath({
      requestingProjectId: "project:test",
      targetPageId: "page:one",
    })).resolves.toEqual({
      libraryId: "library:test",
      storeEpoch: "epoch:test",
      changeLogSeq: 14,
      status: "available",
      targetPageId: "page:one",
      ancestors: [{
        pageId: "page:root",
        title: "Root",
        lifecycle: "active",
      }],
    });
    await expect(adapter.findPageLocation("page:one")).resolves.toEqual({
      pageId: "page:one",
      projectId: "project:test",
    });
    await expect(adapter.findViewLocation("view:test")).resolves.toEqual({
      viewId: "view:test",
      dataSourceId: "source:test",
      databaseId: "database:test",
      projectId: "project:test",
    });
    expect(client.reads).toEqual([
      { kind: "page_target", page_id: "page:one" },
      { kind: "page_ownership_path", page_id: "page:one" },
      { kind: "page_location", page_id: "page:one" },
      { kind: "view_location", view_id: "view:test" },
    ]);
  });

  test("maps one native Page lifecycle compiler snapshot", async () => {
    const client = new FakeCoreClient();
    client.enqueueRead(pageLifecyclePreflightSnapshot());
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.readPageLifecyclePreflight(
      "project:test",
      "page:one",
    )).resolves.toMatchObject({
      ok: true,
      value: {
        projectId: "project:test",
        libraryId: identity.libraryId,
        storeEpoch: identity.storeEpoch,
        changeLogSeq: 15,
        value: {
          tagsProperty: {
            propertyId: "tags",
            dataSourceId: "source:test",
            revision: 1,
          },
          reservedBlockType: null,
          page: {
            pageId: "page:one",
            lifecycle: "active",
            parent: { kind: "data_source", dataSourceId: "source:test" },
            metadataRevision: 3,
            parentRevision: 2,
            membership: {
              membershipId: "membership:one",
              status: "build",
              position: { groupKey: "build", rankKey: "a", revision: 1 },
            },
          },
        },
      },
    });
    expect(client.reads).toEqual([{
      kind: "page_lifecycle_preflight",
      page_id: "page:one",
    }]);
  });

  test("maps Page lifecycle mutations through one native Library aggregate", async () => {
    const client = new FakeCoreClient();
    client.enqueueApply({
      value: {
        affected_resource_ids: ["page:one", "database:test"],
        page_copy: null,
        block_transfer: null,
        page_lifecycle: {
          operation_kind: "archive_page",
          page_id: "page:one",
          metadata_revision: 4,
          parent_revision: 2,
          lifecycle: "archived",
          document_id: "document:one",
          document_generation: 1,
          document_head_seq: 4,
          database_id: "database:test",
          data_source_id: "source:test",
          membership_id: "membership:one",
          view_id: "view:test",
          library_rank_key: null,
          view_rank_key: "7fffffffffffffffffffffffffffffff",
          created_block_ids: [],
          created_tag_option_ids: [],
          delete_evidence: null,
        },
      },
      receipt: {
        operation_id: "lifecycle:archive-one",
        duplicate: false,
        operation_kind: "archive_page",
        did_mutate: true,
        created_target: null,
        affected_parent_keys: ["database:database:test"],
        affected_page_ids: ["page:one"],
        affected_database_ids: ["database:test"],
        affected_view_ids: ["view:test"],
        committed_revisions: { "blockMetadata:page:one": 4 },
        change_log_seq: 16,
        committed_at: "2026-07-20T08:30:00.000Z",
      },
      event_sequence: 16,
      store_epoch: identity.storeEpoch,
    });
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });
    const request = {
      version: 2 as const,
      operationId: "lifecycle:archive-one",
      projectId: "project:test",
      storeEpoch: identity.storeEpoch,
      actor: { kind: "electron_renderer" },
      operation: {
        kind: "archive_page" as const,
        pageId: "page:one",
        expectedMetadataRevision: 3,
      },
    };

    await expect(adapter.applyPageLifecycleMutation(request)).resolves.toEqual({
      ok: true,
      value: {
        version: 2,
        operationKind: "archive_page",
        operationId: request.operationId,
        projectId: request.projectId,
        storeEpoch: identity.storeEpoch,
        pageId: "page:one",
        duplicate: false,
        metadataRevision: 4,
        parentRevision: 2,
        lifecycle: "archived",
        documentId: "document:one",
        documentGeneration: 1,
        documentHeadSeq: 4,
        databaseId: "database:test",
        dataSourceId: "source:test",
        membershipId: "membership:one",
        viewId: "view:test",
        libraryRankKey: null,
        viewRankKey: "7fffffffffffffffffffffffffffffff",
        createdBlockIds: [],
        createdTagOptionIds: [],
        changeLogSeq: 16,
        committedAt: "2026-07-20T08:30:00.000Z",
      },
    });
    expect(client.applies).toEqual([{
      operationId: request.operationId,
      intent: {
        kind: "apply_page_lifecycle",
        mutation: {
          kind: "archive_page",
          page_id: "page:one",
          expected_metadata_revision: 3,
        },
      },
    }]);
  });

  test("maps mixed Page Property mutations through one native Library intent", async () => {
    const client = new FakeCoreClient();
    client.enqueueApply({
      value: {
        affected_resource_ids: ["page:one", "database:test"],
        page_copy: null,
        block_transfer: null,
        page_lifecycle: null,
        block_property_mutation: {
          outcome: {
            status: "committed",
            fields: [{
              scope: "intrinsic",
              path: "intrinsic/page%3Aone/run.target",
              block_id: "page:one",
              property_key: "run.target",
              operation: "set",
              revision: 2,
              value: "cloud",
            }, {
              scope: "data_source",
              path: "data_source/source%3Atest/page%3Aone/status",
              block_id: "page:one",
              data_source_id: "source:test",
              property_id: "status",
              operation: "set",
              revision: 3,
              value: "build",
            }],
            block_metadata_revisions: { "page:one": 7 },
          },
        },
      },
      receipt: {
        operation_id: "property:mixed",
        duplicate: false,
        operation_kind: "property_batch",
        did_mutate: true,
        created_target: null,
        affected_parent_keys: [],
        affected_page_ids: ["page:one"],
        affected_database_ids: ["database:test"],
        affected_view_ids: ["view:test"],
        committed_revisions: {
          "intrinsic/page%3Aone/run.target": 2,
          "data_source/source%3Atest/page%3Aone/status": 3,
        },
        change_log_seq: 21,
        committed_at: "2026-07-20T12:00:00.000Z",
      },
      event_sequence: 21,
      store_epoch: identity.storeEpoch,
    });
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });
    const request: BlockPropertyMutationRequestV2 = {
      version: 2,
      mutationId: "property:mixed",
      projectId: "project:test",
      storeEpoch: identity.storeEpoch,
      clientSessionId: "session:test",
      actor: { kind: "electron_renderer" },
      fields: [{
        scope: "intrinsic",
        blockId: "page:one",
        propertyKey: "run.target",
        operation: "set",
        expectedRevision: 1,
        value: "cloud",
      }, {
        scope: "data_source",
        pageId: "page:one",
        dataSourceId: parseDataSourceId("source:test"),
        propertyId: parseDataSourcePropertyId("status"),
        operation: "set",
        expectedRevision: 2,
        value: "build",
      }],
    };

    await expect(adapter.applyBlockPropertyMutation(request)).resolves.toEqual({
      ok: true,
      value: {
        version: 2,
        mutationId: request.mutationId,
        projectId: request.projectId,
        storeEpoch: identity.storeEpoch,
        duplicate: false,
        fields: [{
          scope: "intrinsic",
          path: "intrinsic/page%3Aone/run.target",
          blockId: "page:one",
          propertyKey: "run.target",
          operation: "set",
          revision: 2,
          value: "cloud",
        }, {
          scope: "data_source",
          path: "data_source/source%3Atest/page%3Aone/status",
          blockId: "page:one",
          dataSourceId: "source:test",
          propertyId: "status",
          operation: "set",
          revision: 3,
          value: "build",
        }],
        blockMetadataRevisions: { "page:one": 7 },
        changeLogSeq: 21,
        committedAt: "2026-07-20T12:00:00.000Z",
      },
    });
    expect(client.applies).toEqual([{
      operationId: request.mutationId,
      intent: {
        kind: "apply_block_property_mutation",
        mutation: {
          actor: request.actor,
          client_session_id: request.clientSessionId,
          fields: [{
            kind: "intrinsic_set",
            block_id: "page:one",
            property_key: "run.target",
            expected_revision: 1,
            value: "cloud",
          }, {
            kind: "data_source_set",
            page_id: "page:one",
            data_source_id: "source:test",
            property_id: "status",
            expected_revision: 2,
            value: "build",
          }],
        },
      },
    }]);
  });

  test("preserves the complete authority-ready Page creation contract", async () => {
    const client = new FakeCoreClient();
    const pageId = "019b0000-0000-7000-8000-000000000001";
    const dataSourceId = parseDataSourceId("source:test");
    const existingOptionId = parseDataSourceOptionId({
      propertyId: "tags",
      value: "o_AAAAAAAA",
    });
    const createdOptionId = parseDataSourceOptionId({
      propertyId: "tags",
      value: "o_BBBBBBBB",
    });
    client.enqueueApply({
      value: {
        affected_resource_ids: [pageId, "database:test"],
        page_copy: null,
        block_transfer: null,
        page_lifecycle: {
          operation_kind: "create_page",
          page_id: pageId,
          metadata_revision: 1,
          parent_revision: 1,
          lifecycle: "active",
          document_id: "document:created",
          document_generation: 1,
          document_head_seq: 1,
          database_id: "database:test",
          data_source_id: "source:test",
          membership_id: "membership:created",
          view_id: "view:test",
          library_rank_key: null,
          view_rank_key: "7fffffffffffffffffffffffffffffff",
          created_block_ids: [pageId, "body:created"],
          created_tag_option_ids: ["o_BBBBBBBB"],
          delete_evidence: null,
        },
      },
      receipt: {
        operation_id: "lifecycle:create-one",
        duplicate: false,
        operation_kind: "create_page",
        did_mutate: true,
        created_target: { kind: "page", page_id: pageId },
        affected_parent_keys: ["database:database:test"],
        affected_page_ids: [pageId],
        affected_database_ids: ["database:test"],
        affected_view_ids: ["view:test"],
        committed_revisions: { [`blockMetadata:${pageId}`]: 1 },
        change_log_seq: 17,
        committed_at: "2026-07-20T08:31:00.000Z",
      },
      event_sequence: 17,
      store_epoch: identity.storeEpoch,
    });
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });
    const richTitle = plainTextToPortableRichText("Rich Page");
    const request: PageLifecycleMutationRequestV2 = {
      version: 2,
      operationId: "lifecycle:create-one",
      projectId: "project:test",
      storeEpoch: identity.storeEpoch,
      clientSessionId: "session:test",
      actor: { kind: "electron_renderer" },
      operation: {
        kind: "create_page",
        pageId,
        title: "Rich Page",
        richTitle,
        nfm: "# Durable body",
        status: "build",
        priority: "p1-high",
        estimate: "m",
        dueDate: "2026-07-31",
        scheduledStart: "2026-07-31T01:00:00.000Z",
        scheduledEnd: "2026-07-31T02:00:00.000Z",
        isAllDay: false,
        recurrence: null,
        reminders: [],
        scheduleTimezone: "Asia/Shanghai",
        assignee: "asc",
        runInTarget: "localProject",
        runInLocalPath: "/tmp/nodex",
        runInBaseBranch: "main",
        runInWorktreePath: null,
        runInEnvironmentPath: null,
        beforeBlockId: "page:before",
        beforeViewPageId: "page:view-before",
        dataSourceId,
        tagOptionIds: [existingOptionId, createdOptionId],
        newTagOptions: [{ optionId: createdOptionId, name: "New tag" }],
        expectedTagsPropertyRevision: 3,
      },
    };

    await expect(adapter.applyPageLifecycleMutation(request)).resolves
      .toMatchObject({
        ok: true,
        value: {
          operationKind: "create_page",
          operationId: request.operationId,
          pageId,
          createdBlockIds: [pageId, "body:created"],
          createdTagOptionIds: ["o_BBBBBBBB"],
        },
      });
    expect(client.applies).toEqual([{
      operationId: request.operationId,
      intent: {
        kind: "apply_page_lifecycle",
        mutation: {
          kind: "create_page",
          page_id: pageId,
          title: "Rich Page",
          rich_title: richTitle,
          nfm: "# Durable body",
          status: "build",
          priority: "p1-high",
          estimate: "m",
          due_date: "2026-07-31",
          scheduled_start: "2026-07-31T01:00:00.000Z",
          scheduled_end: "2026-07-31T02:00:00.000Z",
          is_all_day: false,
          recurrence: null,
          reminders: [],
          schedule_timezone: "Asia/Shanghai",
          assignee: "asc",
          run_in_target: "localProject",
          run_in_local_path: "/tmp/nodex",
          run_in_base_branch: "main",
          run_in_worktree_path: null,
          run_in_environment_path: null,
          before_block_id: "page:before",
          before_view_page_id: "page:view-before",
          data_source_id: "source:test",
          tag_option_ids: ["o_AAAAAAAA", "o_BBBBBBBB"],
          new_tag_options: [{ option_id: "o_BBBBBBBB", name: "New tag" }],
          expected_tags_property_revision: 3,
        },
      },
    }]);
  });

  test("binds reference reads to their Project and locations to the trusted root", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    projectClient.enqueueRead(pageTargetSnapshot());
    projectClient.enqueueRead(pageOwnershipPathSnapshot());
    projectClient.enqueueRead(pageLifecyclePreflightSnapshot());
    rootClient.enqueueRead(pageLocationSnapshot());
    rootClient.enqueueRead(viewLocationSnapshot());
    const requestedProjects: string[] = [];
    const runtime = {
      backend: "rust",
      identity,
      rootClient: Object.assign(rootClient, {
        handshake: fakeHandshake(),
      }),
      clientForProject: (projectId: string) => {
        requestedProjects.push(projectId);
        return projectClient;
      },
    } as unknown as RustDataAuthorityRuntime;
    const bridge = createDesktopLibraryModuleBridge({
      authority: Promise.resolve(runtime),
    });

    await bridge.resolvePageTarget({
      requestingProjectId: "project:test",
      targetPageId: "page:one",
    });
    await bridge.resolvePageOwnershipPath({
      requestingProjectId: "project:test",
      targetPageId: "page:one",
    });
    await expect(bridge.readPageLifecyclePreflight(
      "project:test",
      "page:one",
    )).resolves.toMatchObject({ ok: true });
    await bridge.findPageLocation("page:one");
    await bridge.findViewLocation("view:test");

    expect(requestedProjects).toEqual(["project:test"]);
    expect(projectClient.reads).toHaveLength(3);
    expect(rootClient.reads).toEqual([
      {
        kind: "page_location",
        page_id: "page:one",
      },
      {
        kind: "view_location",
        view_id: "view:test",
      },
    ]);
  });

  test("maps the Project-authorized Page search aggregate", async () => {
    const client = new FakeCoreClient();
    client.enqueueRead(projectPageSearchSnapshot());
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.searchPages({
      projectIds: ["project:test", "project:other"],
      query: "page evidence",
      limit: 25,
    })).resolves.toEqual([{
      projectId: "project:test",
      pageId: "page:one",
      title: "Page One",
      status: "build",
      score: 1_000_000,
      excerpt: "Page search evidence",
    }]);
    expect(client.reads).toEqual([{
      kind: "project_page_search",
      project_ids: ["project:test", "project:other"],
      query: "page evidence",
      limit: 25,
    }]);
  });

  test("maps one complete catalog read without exposing transport shapes", async () => {
    const client = new FakeCoreClient();
    client.enqueueRead({
      contract_version: 2,
      store_epoch: identity.storeEpoch,
      event_head: 7,
      value: {
        kind: "children",
        parent: { kind: "library" },
        items: [
          {
            kind: "page",
            page_id: "page:one",
            title: "One",
            has_children: false,
            parent_revision: 2,
            metadata_revision: 3,
            document_generation: 1,
            document_head_seq: 4,
            updated_at: "2026-07-19T15:00:00.000Z",
          },
        ],
        next_cursor: null,
        has_more: false,
        total: 1,
      },
    });
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.read({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      read: { mode: "children", parent: { kind: "library" } },
    })).resolves.toEqual({
      ok: true,
      value: {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        profileId: identity.profileId,
        libraryId: identity.libraryId,
        storeEpoch: identity.storeEpoch,
        changeLogSeq: 7,
        value: {
          kind: "children",
          parent: { kind: "library" },
          items: [{
            kind: "page",
            pageId: "page:one",
            title: "One",
            hasChildren: false,
            parentRevision: 2,
            metadataRevision: 3,
            documentGeneration: 1,
            documentHeadSeq: 4,
            updatedAt: "2026-07-19T15:00:00.000Z",
          }],
          nextCursor: null,
          hasMore: false,
          total: 1,
        },
      },
    });
    expect(client.reads).toEqual([{
      kind: "children",
      parent: { kind: "library" },
      cursor: null,
      limit: undefined,
      force_include_target: null,
    }]);
  });

  test("maps standalone root reads without deriving Project ownership", async () => {
    const client = new FakeCoreClient();
    client.enqueueRead({
      contract_version: 7,
      store_epoch: identity.storeEpoch,
      event_head: 8,
      value: {
        kind: "standalone_roots",
        items: [{
          kind: "page",
          page_id: "page:standalone",
          title: "Prompts",
          has_children: false,
          parent_revision: 1,
          metadata_revision: 2,
          document_generation: 1,
          document_head_seq: 3,
          updated_at: "2026-08-03T00:00:00.000Z",
        }],
        next_cursor: null,
        has_more: false,
        total: 1,
      },
    });
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.read({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      read: {
        mode: "standalone_roots",
        limit: 10,
        forceIncludeTarget: { kind: "page", pageId: "page:standalone" },
      },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "standalone_roots",
          items: [{ kind: "page", pageId: "page:standalone" }],
          total: 1,
        },
      },
    });
    expect(client.reads).toEqual([{
      kind: "standalone_roots",
      cursor: null,
      limit: 10,
      force_include_target: { kind: "page", page_id: "page:standalone" },
    }]);
  });

  test("maps Canvas targets and typed Canvas lifecycle receipts", async () => {
    const canvasId = "019f7399-7676-70ae-b2aa-168692b64d21";
    const documentId = "019f7399-7676-70ae-b2aa-168692b64d22";
    const client = new FakeCoreClient();
    client.enqueueRead({
      contract_version: 2,
      store_epoch: identity.storeEpoch,
      event_head: 11,
      value: {
        kind: "canvas_target",
        value: {
          status: "available",
          summary: {
            canvas_id: canvasId,
            project_id: "project:test",
            title: "Design map",
            lifecycle: "active",
            is_primary: false,
            location: { kind: "library" },
            metadata_revision: 2,
            location_revision: 3,
            document_generation: 1,
            document_head_seq: 4,
            updated_at: "2026-07-30T15:00:00.000Z",
          },
        },
      },
    });
    client.enqueueApply({
      value: {
        affected_resource_ids: [canvasId],
        canvas_mutation: {
          operation_kind: "create_canvas",
          canvas_id: canvasId,
          document_id: documentId,
          source_canvas_id: null,
          location_revision: 1,
          metadata_revision: 1,
          document_commits: [],
        },
      },
      receipt: {
        operation_id: "operation:create-canvas",
        duplicate: false,
        operation_kind: "create_canvas",
        did_mutate: true,
        created_target: { kind: "canvas", canvas_id: canvasId },
        affected_parent_keys: ["library"],
        affected_page_ids: [],
        affected_database_ids: [],
        affected_view_ids: [],
        committed_revisions: { [canvasId]: 1 },
        change_log_seq: 12,
        committed_at: "2026-07-30T15:01:00.000Z",
      },
      event_sequence: 12,
      store_epoch: identity.storeEpoch,
    });
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.read({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      read: { mode: "canvas_target", canvasId },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "canvas_target",
          value: {
            status: "available",
            summary: {
              canvasId,
              title: "Design map",
              location: { kind: "library" },
            },
          },
        },
      },
    });
    await expect(adapter.apply({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId: "operation:create-canvas",
      storeEpoch: identity.storeEpoch,
      operation: {
        kind: "create_canvas",
        canvasId,
        documentId,
        displayName: "Design map",
        destination: { kind: "library" },
      },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        createdTarget: { kind: "canvas", canvasId },
        canvasMutation: { canvasId, documentId },
      },
    });
    expect(client.applies).toEqual([{
      operationId: "operation:create-canvas",
      intent: {
        kind: "create_canvas",
        canvas_id: canvasId,
        document_id: documentId,
        display_name: "Design map",
        destination: { kind: "library", before: null },
      },
    }]);
  });

  test("round-trips the deterministic primary Canvas target", async () => {
    const canvasId = primaryCanvasBlockId("project:test");
    const client = new FakeCoreClient();
    client.enqueueRead({
      contract_version: 2,
      store_epoch: identity.storeEpoch,
      event_head: 11,
      value: {
        kind: "canvas_target",
        value: {
          status: "available",
          summary: {
            canvas_id: canvasId,
            project_id: "project:test",
            title: "Canvas",
            lifecycle: "active",
            is_primary: true,
            location: { kind: "library" },
            metadata_revision: 1,
            location_revision: 1,
            document_generation: 1,
            document_head_seq: 0,
            updated_at: "2026-07-31T15:00:00.000Z",
          },
        },
      },
    });
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.read({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      read: { mode: "canvas_target", canvasId },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "canvas_target",
          value: {
            status: "available",
            summary: { canvasId, isPrimary: true },
          },
        },
      },
    });
    expect(client.reads).toEqual([{
      kind: "canvas_target",
      canvas_id: canvasId,
    }]);
  });

  test("publishes Canvas host commits to mounted Project and Library Documents", async () => {
    const projectClient = new FakeCoreClient();
    const canvasId = "019f7399-7676-70ae-b2aa-168692b64d31";
    const canvasDocumentId = "019f7399-7676-70ae-b2aa-168692b64d32";
    projectClient.enqueueApply({
      value: {
        affected_resource_ids: [canvasId],
        canvas_mutation: {
          operation_kind: "create_canvas",
          canvas_id: canvasId,
          document_id: canvasDocumentId,
          source_canvas_id: null,
          location_revision: 1,
          metadata_revision: 1,
          document_commits: [{
            document_id: "document:page",
            generation: 2,
            base_head_seq: 7,
            head_seq: 8,
            update_id: "update:canvas-shell",
            update: [1, 2, 3],
            state_vector: [4, 5],
          }],
        },
      },
      receipt: {
        operation_id: "operation:create-inline-canvas",
        duplicate: false,
        operation_kind: "create_canvas",
        did_mutate: true,
        created_target: { kind: "canvas", canvas_id: canvasId },
        affected_parent_keys: ["page:page:one"],
        affected_page_ids: ["page:one"],
        affected_database_ids: [],
        affected_view_ids: [],
        committed_revisions: { [canvasId]: 1 },
        change_log_seq: 13,
        committed_at: "2026-07-30T15:02:00.000Z",
      },
      event_sequence: 13,
      store_epoch: identity.storeEpoch,
    });
    const runtime = {
      backend: "rust",
      identity,
      rootClient: { handshake: fakeHandshake() },
      clientForProject: () => projectClient,
    } as unknown as RustDataAuthorityRuntime;
    const published: Array<Record<string, unknown>> = [];
    const bridge = createDesktopLibraryModuleBridge({
      authority: Promise.resolve(runtime),
      publishLibraryDocumentCommits: (input) => published.push(input),
    });

    const result = await bridge.apply(
      { kind: "project", projectId: "project:test" },
      {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        operationId: "operation:create-inline-canvas",
        storeEpoch: identity.storeEpoch,
        operation: {
          kind: "create_canvas",
          canvasId,
          documentId: canvasDocumentId,
          displayName: "Inline Canvas",
          destination: { kind: "library" },
        },
      },
    );

    expect(result).toMatchObject({ ok: true });
    expect(published).toEqual([
      expect.objectContaining({
        storeEpoch: identity.storeEpoch,
        clientSessionId: "rust:library",
        commits: [expect.objectContaining({
          documentId: "document:page",
          generation: 2,
          headSeq: 8,
        })],
      }),
    ]);
  });

  test("maps a committed aggregate and rejects a stale epoch before Core", async () => {
    const client = new FakeCoreClient();
    client.enqueueApply({
      value: {
        affected_resource_ids: ["page:one"],
        page_copy: null,
        block_transfer: null,
        page_lifecycle: null,
      },
      receipt: {
        operation_id: "operation:create",
        duplicate: false,
        operation_kind: "create_page",
        did_mutate: true,
        created_target: { kind: "page", page_id: "page:one" },
        affected_parent_keys: ["library"],
        affected_page_ids: ["page:one"],
        affected_database_ids: [],
        affected_view_ids: [],
        committed_revisions: { "page:one": 1 },
        change_log_seq: 8,
        committed_at: "2026-07-19T15:01:00.000Z",
      },
      event_sequence: 8,
      store_epoch: identity.storeEpoch,
    });
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });
    const request = {
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId: "operation:create",
      storeEpoch: identity.storeEpoch,
      operation: {
        kind: "create_page" as const,
        pageId: "page:one",
        documentId: "document:one",
        title: "One",
        parent: { kind: "library" as const },
      },
    };

    await expect(adapter.apply(request)).resolves.toMatchObject({
      ok: true,
      value: {
        operationId: request.operationId,
        createdTarget: { kind: "page", pageId: "page:one" },
        duplicate: false,
        changeLogSeq: 8,
      },
    });
    expect(client.applies).toEqual([{
      operationId: request.operationId,
      intent: {
        kind: "create_page",
        page_id: "page:one",
        document_id: "document:one",
        title: "One",
        parent: { kind: "library", before: null },
      },
    }]);

    await expect(adapter.apply({ ...request, storeEpoch: "epoch:stale" })).resolves
      .toMatchObject({ ok: false, error: { code: "store_epoch_mismatch" } });
    expect(client.applies).toHaveLength(1);
  });

  test("routes trusted Library writes through the root Core client", async () => {
    const rootClient = new FakeCoreClient();
    rootClient.enqueueApply({
      value: {
        affected_resource_ids: ["page:trusted"],
        page_copy: null,
        block_transfer: null,
        page_lifecycle: null,
      },
      receipt: {
        operation_id: "operation:trusted",
        duplicate: false,
        operation_kind: "create_page",
        did_mutate: true,
        created_target: { kind: "page", page_id: "page:trusted" },
        affected_parent_keys: ["library"],
        affected_page_ids: ["page:trusted"],
        affected_database_ids: [],
        affected_view_ids: [],
        committed_revisions: { "page:trusted": 1 },
        change_log_seq: 9,
        committed_at: "2026-07-20T00:00:00.000Z",
      },
      event_sequence: 9,
      store_epoch: identity.storeEpoch,
    });
    const runtime = {
      backend: "rust",
      identity,
      rootClient: Object.assign(rootClient, {
        handshake: fakeHandshake(),
      }),
      clientForProject: () => {
        throw new Error("Trusted Library writes must not resolve a Project client");
      },
    } as unknown as RustDataAuthorityRuntime;
    const bridge = createDesktopLibraryModuleBridge({
      authority: Promise.resolve(runtime),
    });
    const request = {
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId: "operation:trusted",
      storeEpoch: identity.storeEpoch,
      operation: {
        kind: "create_page" as const,
        pageId: "page:trusted",
        documentId: "document:trusted",
        title: "Trusted",
        parent: { kind: "library" as const },
      },
    };

    await expect(bridge.apply({ kind: "library" }, request)).resolves.toMatchObject({
      ok: true,
      value: {
        operationId: request.operationId,
        createdTarget: { kind: "page", pageId: "page:trusted" },
      },
    });
    expect(rootClient.applies).toHaveLength(1);
  });

  test("maps only Library Core events into renderer invalidations", () => {
    expect(mapCoreLibraryEvent({
      transport_version: 4,
      event: {
        event_version: 2,
        sequence: 9,
        store_epoch: identity.storeEpoch,
        operation_id: "operation:create",
        committed_at: "2026-07-19T15:02:00.000Z",
        projection_impact: { kind: "none" },
        payload: {
          module: "library",
          event: {
            kind: "library_changed",
            page_ids: ["page:one"],
            database_ids: ["database:one"],
            view_ids: [],
            parent_keys: ["library"],
          },
        },
      },
    }, identity.libraryId)).toEqual({
      version: LIBRARY_NAVIGATION_EVENT_VERSION,
      libraryId: identity.libraryId,
      storeEpoch: identity.storeEpoch,
      changeLogSeq: 9,
      changeKind: "content",
      affectedParentKeys: ["library"],
      affectedPageIds: ["page:one"],
      affectedDatabaseIds: ["database:one"],
      affectedViewIds: [],
    });
  });
});
