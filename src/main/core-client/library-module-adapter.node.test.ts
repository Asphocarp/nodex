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

const emptyCanonicalPageWindow = () => ({
  store_epoch: identity.storeEpoch,
  library_id: identity.libraryId,
  graph: {
    library_id: identity.libraryId,
    blocks: [],
    placements: [],
  },
  view_positions: [],
  content: [],
  observed_cursor: {
    store_epoch: identity.storeEpoch,
    commit_seq: 0,
  },
});

const canonicalPageWindow = (input: {
  readonly pageId: string;
  readonly lifecycle: "active" | "archived" | "retired";
  readonly parent:
    | { readonly kind: "library" }
    | { readonly kind: "block"; readonly id: string }
    | { readonly kind: "data_source"; readonly id: string };
  readonly rankKey: string;
  readonly revision?: number;
  readonly viewPositions?: readonly {
    readonly view_id: string;
    readonly data_source_id: string;
    readonly block_id: string;
    readonly group_key: string | null;
    readonly rank_key: string;
    readonly revision: number;
  }[];
}) => ({
  store_epoch: identity.storeEpoch,
  library_id: identity.libraryId,
  graph: {
    library_id: identity.libraryId,
    blocks: [{
      id: input.pageId,
      library_id: identity.libraryId,
      kind: "page",
      lifecycle: input.lifecycle,
      properties: { title: input.pageId },
      content_shard_id: `shard:${input.pageId}`,
      revision: input.revision ?? 0,
    }],
    placements: [{
      block_id: input.pageId,
      parent: input.parent,
      rank_key: input.rankKey,
      revision: input.revision ?? 0,
    }],
  },
  view_positions: input.viewPositions ?? [],
  content: [],
  observed_cursor: {
    store_epoch: identity.storeEpoch,
    commit_seq: 8,
  },
});

const canonicalPageCommit = (
  operationId: string,
  pageId: string,
  revision = 0,
) => ({
  cursor: { store_epoch: identity.storeEpoch, commit_seq: 8 },
  commit_id: `commit:${operationId}`,
  operation_id: operationId,
  intent_hash: "a".repeat(64),
  canonical_hash: "b".repeat(64),
  actor_id: "profile:profile:test",
  session_id: "library-module:library:test",
  committed_at: "2026-07-19T15:01:00.000Z",
  effects: [{
    kind: "record",
    value: { blockId: pageId, kind: "page", revision },
  }],
  audience: { kind: "library", projectIds: [] },
  payload_completeness: "rich" as const,
  duplicate: false,
});

const canonicalDataSourceWindow = () => ({
  store_epoch: identity.storeEpoch,
  library_id: identity.libraryId,
  graph: {
    library_id: identity.libraryId,
    blocks: ["page:before", "page:view-before"].map((id) => ({
      id,
      library_id: identity.libraryId,
      kind: "page",
      lifecycle: "active",
      properties: { title: id, status: "build" },
      content_shard_id: `shard:${id}`,
      revision: 0,
    })),
    placements: [
      {
        block_id: "page:before",
        parent: { kind: "data_source" as const, id: "source:test" },
        rank_key: "80000000000000000000000000000000",
        revision: 0,
      },
      {
        block_id: "page:view-before",
        parent: { kind: "data_source" as const, id: "source:test" },
        rank_key: "c0000000000000000000000000000000",
        revision: 0,
      },
    ],
  },
  view_positions: [
    {
      view_id: "view:test",
      data_source_id: "source:test",
      block_id: "page:before",
      group_key: null,
      rank_key: "80000000000000000000000000000000",
      revision: 0,
    },
    {
      view_id: "view:test",
      data_source_id: "source:test",
      block_id: "page:view-before",
      group_key: null,
      rank_key: "c0000000000000000000000000000000",
      revision: 0,
    },
  ],
  content: [],
  observed_cursor: {
    store_epoch: identity.storeEpoch,
    commit_seq: 16,
  },
});

const pageDetailSnapshot = () => ({
  contract_version: 9 as const,
  store_epoch: identity.storeEpoch,
  event_head: 9,
  value: {
    kind: "page_detail" as const,
    value: {
      version: 3,
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
  schema: { kind: "multi_select" as const },
  capabilities: {
    replace: true,
    patchSetMember: "option" as const,
    filterOperators: ["contains", "not_contains", "is_empty", "is_not_empty"] as const,
    sortable: true,
    groupable: true,
  },
  valueType: "multi_select",
  config: {
    options: [{ id: "o_AAAAAAAA", name: "Release", color: "blue" }],
  },
  optionCount: 0,
  rankKey: "b",
  lifecycle: "active",
  revision: 1,
  createdAt: "2026-07-19T18:00:00.000Z",
  updatedAt: "2026-07-19T18:00:00.000Z",
});

const lifecycleCoreTagsProperty = () => ({
  property_id: "tags",
  data_source_id: "source:test",
  name: "Tags",
  schema: { kind: "multi_select" as const },
  capabilities: {
    replace: true,
    patch_set_member: "option" as const,
    filter_operators: ["contains", "not_contains", "is_empty", "is_not_empty"] as const,
    sortable: true,
    groupable: true,
  },
  option_count: 0,
  rank_key: "b",
  lifecycle: "active",
  revision: 1,
  created_at: "2026-07-19T18:00:00.000Z",
  updated_at: "2026-07-19T18:00:00.000Z",
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
  properties: [lifecycleCoreTagsProperty()],
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

const pageLifecycleCreatePreflightSnapshot = () => {
  const snapshot = pageLifecyclePreflightSnapshot();
  return {
    ...snapshot,
    value: {
      ...snapshot.value,
      value: {
        ...snapshot.value.value,
        page: null,
      },
    },
  };
};

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
      accessContext: { kind: "project", projectId: "project:test" },
      targetPageId: "page:one",
    })).resolves.toMatchObject({
      status: "available",
      targetPageId: "page:one",
      page: { pageId: "page:one", lifecycle: "active" },
      document: { readiness: "ready", schemaKey: "nodex.page" },
    });
    await expect(adapter.resolvePageOwnershipPath({
      accessContext: { kind: "project", projectId: "project:test" },
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

  test("maps legacy Page lifecycle requests to canonical BlockRecord operations", async () => {
    const client = new FakeCoreClient();
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:one",
      lifecycle: "active",
      parent: { kind: "library" },
      rankKey: "40000000000000000000000000000000",
      revision: 2,
    }));
    client.enqueueBlockRecordApply(canonicalPageCommit(
      "lifecycle:archive-one",
      "page:one",
    ));
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

    await expect(adapter.applyPageLifecycleMutation(request)).resolves.toMatchObject({
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
        parentRevision: 4,
        lifecycle: "archived",
        documentId: "block-record:page:one",
        documentGeneration: 0,
        documentHeadSeq: 0,
        libraryRankKey: null,
        changeLogSeq: 8,
      },
    });
    expect(client.applies).toEqual([]);
    expect(client.blockRecordApplies).toHaveLength(1);
    expect(client.blockRecordApplies[0]).toMatchObject({
      operation_id: request.operationId,
      operation: {
        kind: "archive_subtree",
        block_id: "page:one",
        expected_block_revision: 2,
        expected_placement_revision: 2,
      },
    });
  });

  test("restores and reorders canonical Pages through lifecycle V2", async () => {
    const client = new FakeCoreClient();
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:one",
      lifecycle: "archived",
      parent: { kind: "library" },
      rankKey: "__nodex_archived__page:one__40000000000000000000000000000000",
      revision: 1,
    }));
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:two",
      lifecycle: "active",
      parent: { kind: "library" },
      rankKey: "c0000000000000000000000000000000",
      revision: 4,
    }));
    client.enqueueBlockRecordApply(canonicalPageCommit(
      "lifecycle:unarchive-one",
      "page:one",
    ));
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:one",
      lifecycle: "active",
      parent: { kind: "library" },
      rankKey: "40000000000000000000000000000000",
      revision: 2,
    }));
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:two",
      lifecycle: "active",
      parent: { kind: "library" },
      rankKey: "c0000000000000000000000000000000",
      revision: 4,
    }));
    client.enqueueBlockRecordApply(canonicalPageCommit(
      "lifecycle:move-one",
      "page:one",
    ));
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.applyPageLifecycleMutation({
      version: 2,
      operationId: "lifecycle:unarchive-one",
      projectId: "project:test",
      storeEpoch: identity.storeEpoch,
      actor: { kind: "electron_renderer" },
      operation: {
        kind: "unarchive_page",
        pageId: "page:one",
        expectedMetadataRevision: 2,
      },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        operationKind: "unarchive_page",
        metadataRevision: 3,
        parentRevision: 3,
        lifecycle: "active",
        documentId: "block-record:page:one",
        documentGeneration: 0,
        documentHeadSeq: 0,
      },
    });

    await expect(adapter.applyPageLifecycleMutation({
      version: 2,
      operationId: "lifecycle:move-one",
      projectId: "project:test",
      storeEpoch: identity.storeEpoch,
      actor: { kind: "electron_renderer" },
      operation: {
        kind: "move_page_in_library",
        pageId: "page:one",
        expectedParentRevision: 3,
        beforeBlockId: "page:two",
      },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        operationKind: "move_page_in_library",
        metadataRevision: 3,
        parentRevision: 4,
        lifecycle: "active",
      },
    });

    expect(client.applies).toEqual([]);
    expect(client.blockRecordApplies.map((entry) => entry.operation.kind)).toEqual([
      "restore_subtree",
      "move_many",
    ]);
    expect(client.blockRecordApplies[1]).toMatchObject({
      operation: {
        entries: [{
          block_id: "page:one",
          target_parent: { kind: "library" },
          expected_block_revision: 2,
          expected_placement_revision: 2,
        }],
      },
    });
  });

  test("deletes and restores a Library Page through the retired BlockRecord path", async () => {
    const client = new FakeCoreClient();
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:one",
      lifecycle: "active",
      parent: { kind: "library" },
      rankKey: "40000000000000000000000000000000",
      revision: 2,
    }));
    client.enqueueBlockRecordApply(canonicalPageCommit("lifecycle:delete-one", "page:one"));
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:one",
      lifecycle: "retired",
      parent: { kind: "library" },
      rankKey: "__nodex_retired__page:one__40000000000000000000000000000000",
      revision: 3,
    }));
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:two",
      lifecycle: "active",
      parent: { kind: "library" },
      rankKey: "c0000000000000000000000000000000",
      revision: 4,
    }));
    client.enqueueBlockRecordApply(canonicalPageCommit("lifecycle:restore-one", "page:one"));
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.applyPageLifecycleMutation({
      version: 2,
      operationId: "lifecycle:delete-one",
      projectId: "project:test",
      storeEpoch: identity.storeEpoch,
      actor: { kind: "electron_renderer" },
      operation: {
        kind: "delete_page",
        pageId: "page:one",
        expectedMetadataRevision: 3,
        expectedParentRevision: 3,
      },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        operationKind: "delete_page",
        lifecycle: "deleted",
        metadataRevision: 4,
        parentRevision: 4,
        documentId: "block-record:page:one",
      },
    });

    await expect(adapter.applyPageLifecycleMutation({
      version: 2,
      operationId: "lifecycle:restore-one",
      projectId: "project:test",
      storeEpoch: identity.storeEpoch,
      actor: { kind: "electron_renderer" },
      operation: {
        kind: "restore_page",
        pageId: "page:one",
        deleteOperationId: "lifecycle:delete-one",
        expectedMetadataRevision: 4,
        expectedParentRevision: 4,
        membership: null,
        beforeBlockId: "page:two",
      },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        operationKind: "restore_page",
        lifecycle: "active",
        metadataRevision: 5,
        parentRevision: 5,
        libraryRankKey: "60000000000000000000000000000000",
      },
    });

    expect(client.applies).toEqual([]);
    expect(client.blockRecordApplies.map((entry) => entry.operation.kind)).toEqual([
      "retire_subtree",
      "batch",
    ]);
    expect(client.blockRecordApplies[1]).toMatchObject({
      operation: {
        operations: [{
          kind: "restore_subtree",
          block_id: "page:one",
          target_parent: { kind: "library" },
          expected_block_revision: 3,
          expected_placement_revision: 3,
        }],
      },
    });
    expect(client.blockRecordReads).toEqual([
      expect.objectContaining({ block_ids: ["page:one"] }),
      expect.objectContaining({
        block_ids: ["page:one"],
        include_retired: true,
      }),
      expect.objectContaining({ parent: { kind: "library" } }),
    ]);
  });

  test("restores a deleted Board Page and its View position in one batch", async () => {
    const client = new FakeCoreClient();
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:one",
      lifecycle: "active",
      parent: { kind: "data_source", id: "source:test" },
      rankKey: "60000000000000000000000000000000",
      revision: 2,
    }));
    client.enqueueBlockRecordApply(canonicalPageCommit("lifecycle:delete-board", "page:one"));
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:one",
      lifecycle: "retired",
      parent: { kind: "data_source", id: "source:test" },
      rankKey: "__nodex_retired__page:one__60000000000000000000000000000000",
      revision: 3,
      viewPositions: [{
        view_id: "view:test",
        data_source_id: "source:test",
        block_id: "page:one",
        group_key: "build",
        rank_key: "40000000000000000000000000000000",
        revision: 5,
      }],
    }));
    const destination = canonicalDataSourceWindow();
    client.enqueueBlockRecordRead({
      ...destination,
      view_positions: destination.view_positions.map((position) => ({
        ...position,
        group_key: "build",
      })),
    });
    client.enqueueBlockRecordApply(canonicalPageCommit("lifecycle:restore-board", "page:one"));
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.applyPageLifecycleMutation({
      version: 2,
      operationId: "lifecycle:delete-board",
      projectId: "project:test",
      storeEpoch: identity.storeEpoch,
      actor: { kind: "electron_renderer" },
      operation: {
        kind: "delete_page",
        pageId: "page:one",
        expectedMetadataRevision: 3,
        expectedParentRevision: 3,
      },
    })).resolves.toMatchObject({ ok: true, value: { lifecycle: "deleted" } });

    await expect(adapter.applyPageLifecycleMutation({
      version: 2,
      operationId: "lifecycle:restore-board",
      projectId: "project:test",
      storeEpoch: identity.storeEpoch,
      actor: { kind: "electron_renderer" },
      operation: {
        kind: "restore_page",
        pageId: "page:one",
        deleteOperationId: "lifecycle:delete-board",
        expectedMetadataRevision: 4,
        expectedParentRevision: 4,
        membership: {
          membershipId: "membership:one",
          databaseId: "database:test",
          dataSourceId: "source:test",
          status: "build",
          position: {
            viewId: "view:test",
            beforeViewPageId: "page:view-before",
          },
        },
      },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        lifecycle: "active",
        databaseId: "database:test",
        dataSourceId: "source:test",
        membershipId: "membership:one",
        viewId: "view:test",
        viewRankKey: "a0000000000000000000000000000000",
      },
    });

    expect(client.blockRecordApplies[0]).toMatchObject({
      operation: {
        kind: "retire_subtree",
        retire_operation_id: "lifecycle:delete-board",
      },
    });
    expect(client.blockRecordApplies[1]).toMatchObject({
      operation: {
        kind: "batch",
        operations: [{
          kind: "restore_subtree",
          expected_retire_operation_id: "lifecycle:delete-board",
          target_parent: { kind: "data_source", id: "source:test" },
        }, {
          kind: "update_many",
          entries: [{
            block_id: "page:one",
            expected_block_revision: 4,
            view_id: "view:test",
            data_source_id: "source:test",
            view_group_key: "build",
            view_rank_key: "a0000000000000000000000000000000",
            expected_view_revision: 5,
          }],
        }],
      },
    });
    expect(client.blockRecordReads).toEqual([
      expect.objectContaining({ block_ids: ["page:one"] }),
      expect.objectContaining({
        block_ids: ["page:one"],
        include_retired: true,
        view_id: "view:test",
      }),
      expect.objectContaining({
        parent: { kind: "data_source", id: "source:test" },
        view_id: "view:test",
      }),
    ]);
  });

  test("maps intrinsic Page Property mutations through one canonical LocalCommit", async () => {
    const client = new FakeCoreClient();
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:one",
      lifecycle: "active",
      parent: { kind: "library" },
      rankKey: "40000000000000000000000000000000",
      revision: 0,
    }));
    client.enqueueBlockRecordApply(canonicalPageCommit("property:mixed", "page:one", 1));
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
        }],
        blockMetadataRevisions: { "page:one": 2 },
        changeLogSeq: 8,
        committedAt: "2026-07-19T15:01:00.000Z",
      },
    });
    expect(client.applies).toEqual([]);
    expect(client.blockRecordApplies[0]).toMatchObject({
      operation_id: request.mutationId,
      operation: {
        kind: "batch",
        operations: [{
          kind: "patch_properties",
          block_id: "page:one",
          properties: { "run.target": "cloud" },
          expected_block_revision: 0,
        }],
      },
    });
  });

  test("maps atomic Page metadata writes to Database and intrinsic native intents", async () => {
    const client = new FakeCoreClient();
    const dataSourceId = parseDataSourceId("source:test");
    const propertyId = parseDataSourcePropertyId("priority");
    const optionId = parseDataSourceOptionId({ propertyId, value: "p1-high" });
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:one",
      lifecycle: "active",
      parent: { kind: "library" },
      rankKey: "40000000000000000000000000000000",
      revision: 1,
    }));
    client.enqueueBlockRecordApply(canonicalPageCommit(
      "property:metadata",
      "page:one",
      3,
    ));
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.apply({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId: "property:metadata",
      storeEpoch: identity.storeEpoch,
      operation: {
        kind: "apply_page_metadata_properties",
        clientSessionId: "window:one",
        databaseOperations: [{
          kind: "edit_property_values",
          edits: [{
            pageId: "page:one",
            dataSourceId,
            propertyId,
            edit: {
              kind: "replace",
              expectedValueRevision: 4,
              value: { kind: "select", optionId },
            },
          }],
        }],
        intrinsicFields: [{
          scope: "intrinsic",
          blockId: "page:one",
          propertyKey: "schedule.isAllDay",
          operation: "set",
          expectedRevision: 2,
          value: true,
        }],
      },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        operationKind: "apply_page_metadata_properties",
        didMutate: true,
        affectedParentKeys: ["library"],
        affectedPageIds: ["page:one"],
        committedRevisions: { "blockMetadata:page:one": 4 },
      },
    });
    expect(client.applies).toEqual([]);
    expect(client.blockRecordApplies[0]).toMatchObject({
      operation_id: "property:metadata",
      session_id: "window:one",
      operation: {
        kind: "batch",
        operations: [{
          kind: "patch_properties",
          block_id: "page:one",
          properties: { "schedule.isAllDay": true },
          expected_block_revision: 1,
        }, {
          kind: "apply_database",
          intents: [{
            kind: "edit_property_values",
            edits: [{
              address: {
                page_id: "page:one",
                data_source_id: dataSourceId,
                property_id: propertyId,
              },
              edit: {
                kind: "replace",
                expected_value_revision: 4,
                value: { kind: "select", option_id: optionId },
              },
            }],
          }],
        }],
      },
    });
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
    client.enqueueRead(pageLifecycleCreatePreflightSnapshot());
    client.enqueueBlockRecordRead(canonicalDataSourceWindow());
    client.enqueueBlockRecordApply(canonicalPageCommit("lifecycle:create-one", pageId, 1));
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

    const result = await adapter.applyPageLifecycleMutation(request);
    expect(result)
      .toMatchObject({
        ok: true,
        value: {
          operationKind: "create_page",
          operationId: request.operationId,
          pageId,
          createdBlockIds: [pageId, `${pageId}:body:0`],
          createdTagOptionIds: ["o_BBBBBBBB"],
        },
      });
    expect(client.applies).toEqual([]);
    expect(client.blockRecordApplies).toHaveLength(1);
    expect(client.blockRecordApplies[0]?.operation).toMatchObject({
      kind: "batch",
      operations: [
        {
          kind: "create",
          block_id: pageId,
          parent: { kind: "data_source", id: "source:test" },
          view_id: "view:test",
          data_source_id: "source:test",
          view_group_key: null,
          properties: {
            title: "Rich Page",
            description: "# Durable body",
            status: "build",
            priority: "p1-high",
            tags: ["o_AAAAAAAA", "o_BBBBBBBB"],
          },
        },
        {
          kind: "reconcile_page_tree",
          page_id: pageId,
          nodes: [{ block_id: `${pageId}:body:0`, parent_block_id: pageId }],
        },
        {
          kind: "set_data_source_values",
          block_id: pageId,
          data_source_id: "source:test",
          values: [
            { property_id: "status", value: "build" },
            { property_id: "priority", value: "p1-high" },
            { property_id: "estimate", value: "m" },
            { property_id: "tags", value: ["o_AAAAAAAA", "o_BBBBBBBB"] },
            { property_id: "due_date", value: "2026-07-31" },
            { property_id: "scheduled_start", value: "2026-07-31T01:00:00.000Z" },
            { property_id: "scheduled_end", value: "2026-07-31T02:00:00.000Z" },
            { property_id: "assignee", value: "asc" },
          ],
        },
        {
          kind: "apply_database",
          intents: [{
            kind: "put_option",
            data_source_id: "source:test",
            property_id: "tags",
            option_id: "o_BBBBBBBB",
            name: "New tag",
            expected_property_revision: 3,
          }],
        },
      ],
    });
  });

  test("binds reference reads to explicit Project or Library authority", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    projectClient.enqueueRead(pageTargetSnapshot());
    projectClient.enqueueRead(pageOwnershipPathSnapshot());
    projectClient.enqueueRead(pageLifecyclePreflightSnapshot());
    rootClient.enqueueRead(pageTargetSnapshot());
    rootClient.enqueueRead(pageOwnershipPathSnapshot());
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
      accessContext: { kind: "project", projectId: "project:test" },
      targetPageId: "page:one",
    });
    await bridge.resolvePageOwnershipPath({
      accessContext: { kind: "project", projectId: "project:test" },
      targetPageId: "page:one",
    });
    await bridge.resolvePageTarget({
      accessContext: { kind: "library" },
      targetPageId: "page:one",
    });
    await bridge.resolvePageOwnershipPath({
      accessContext: { kind: "library" },
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
        kind: "page_target",
        page_id: "page:one",
      },
      {
        kind: "page_ownership_path",
        page_id: "page:one",
      },
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
      contract_version: 8,
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

  test("maps the Project access matrix and atomic access intent", async () => {
    const client = new FakeCoreClient();
    client.enqueueRead({
      contract_version: 8,
      store_epoch: identity.storeEpoch,
      event_head: 9,
      value: {
        kind: "resource_project_access",
        value: {
          target: { kind: "page", page_id: "page:one" },
          projects: [{
            project_id: "project:test",
            project_name: "Product",
            appearance: {
              color: "blue",
              marker: { kind: "icon", icon: "folder" },
            },
            lifecycle: "active",
            direct_grant: { access: "read", revision: 2 },
            inherited_sources: [{
              kind: "ancestor_page",
              page_id: "page:parent",
              page_title: "Strategy",
              access: "read_write",
            }],
            effective_access: "read_write",
          }],
        },
      },
    });
    client.enqueueApply({
      value: {
        affected_resource_ids: ["page:one"],
        page_copy: null,
        block_transfer: null,
        page_lifecycle: null,
      },
      receipt: {
        operation_id: "operation:set-access",
        duplicate: false,
        operation_kind: "set_project_access",
        did_mutate: true,
        created_target: null,
        affected_parent_keys: [],
        affected_page_ids: ["page:one"],
        affected_database_ids: [],
        affected_view_ids: [],
        committed_revisions: { "projectGrant:project:test": 3 },
        change_log_seq: 10,
        committed_at: "2026-08-04T00:00:00.000Z",
      },
      event_sequence: 10,
      store_epoch: identity.storeEpoch,
    });
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.read({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      read: {
        mode: "resource_project_access",
        target: { kind: "page", pageId: "page:one" },
      },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "resource_project_access",
          value: {
            projects: [{
              projectId: "project:test",
              directGrant: { access: "read", revision: 2 },
              inheritedSources: [{
                kind: "ancestor_page",
                pageId: "page:parent",
              }],
            }],
          },
        },
      },
    });
    await expect(adapter.apply({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId: "operation:set-access",
      storeEpoch: identity.storeEpoch,
      operation: {
        kind: "set_project_access",
        target: { kind: "page", pageId: "page:one" },
        changes: [{
          projectId: "project:test",
          access: null,
          expectedRevision: 2,
        }],
      },
    })).resolves.toMatchObject({
      ok: true,
      value: { operationKind: "set_project_access", didMutate: true },
    });
    expect(client.reads).toEqual([{
      kind: "resource_project_access",
      target: { kind: "page", page_id: "page:one" },
    }]);
    expect(client.applies).toEqual([{
      operationId: "operation:set-access",
      intent: {
        kind: "set_project_access",
        target: { kind: "page", page_id: "page:one" },
        changes: [{
          project_id: "project:test",
          access: null,
          expected_revision: 2,
        }],
      },
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
    client.enqueueBlockRecordRead(emptyCanonicalPageWindow());
    client.enqueueBlockRecordApply(canonicalPageCommit("operation:create", "page:one"));
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
    expect(client.applies).toEqual([]);
    expect(client.blockRecordApplies).toHaveLength(1);
    expect(client.blockRecordApplies[0]).toMatchObject({
      operation_id: request.operationId,
      operation: {
        kind: "create",
        block_id: "page:one",
        block_kind: "page",
        parent: { kind: "library" },
        materialized_json: plainTextToPortableRichText("One"),
      },
    });

    await expect(adapter.apply({ ...request, storeEpoch: "epoch:stale" })).resolves
      .toMatchObject({ ok: false, error: { code: "store_epoch_mismatch" } });
    expect(client.blockRecordApplies).toHaveLength(1);
  });

  test("routes canonical Page Move through one BlockRecord transaction", async () => {
    const client = new FakeCoreClient();
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:one",
      lifecycle: "active",
      parent: { kind: "library" },
      rankKey: "40000000000000000000000000000000",
    }));
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:two",
      lifecycle: "active",
      parent: { kind: "library" },
      rankKey: "80000000000000000000000000000000",
    }));
    client.enqueueBlockRecordApply(canonicalPageCommit("operation:move", "page:one"));
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.apply({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId: "operation:move",
      storeEpoch: identity.storeEpoch,
      operation: {
        kind: "move_block",
        target: {
          kind: "page",
          pageId: "page:one",
          expectedLocationRevision: 1,
        },
        parent: {
          kind: "page",
          pageId: "page:two",
          expectedDocumentGeneration: 0,
          expectedDocumentHeadSeq: 0,
        },
      },
    })).resolves.toMatchObject({
      ok: true,
      value: {
        operationKind: "move_block",
        affectedParentKeys: ["library", "page:page:two"],
      },
    });
    expect(client.applies).toHaveLength(0);
    expect(client.blockRecordApplies[0]).toMatchObject({
      operation_id: "operation:move",
      operation: {
        kind: "move_many",
        entries: [{
          block_id: "page:one",
          target_parent: { kind: "block", id: "page:two" },
          expected_block_revision: 0,
          expected_placement_revision: 0,
        }],
      },
    });
  });

  test("archives and restores a canonical Page without falling back to legacy Library writes", async () => {
    const client = new FakeCoreClient();
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:one",
      lifecycle: "active",
      parent: { kind: "library" },
      rankKey: "40000000000000000000000000000000",
    }));
    client.enqueueBlockRecordApply(canonicalPageCommit("operation:archive", "page:one"));
    client.enqueueBlockRecordRead(canonicalPageWindow({
      pageId: "page:one",
      lifecycle: "archived",
      parent: { kind: "library" },
      rankKey: "__nodex_archived__page:one__fffffffffffffffffffffffffffffffe",
      revision: 1,
    }));
    const restoreDestination = {
      ...emptyCanonicalPageWindow(),
      graph: {
        library_id: identity.libraryId,
        blocks: [{
          id: "page:two",
          library_id: identity.libraryId,
          kind: "page" as const,
          lifecycle: "active" as const,
          properties: { title: "page:two" },
          content_shard_id: "shard:page:two",
          revision: 9,
        }],
        placements: [{
          block_id: "page:two",
          parent: { kind: "library" as const },
          rank_key: "fffffffffffffffffffffffffffffffe",
          revision: 9,
        }],
      },
    };
    client.enqueueBlockRecordRead(restoreDestination);
    client.enqueueBlockRecordApply(canonicalPageCommit("operation:restore", "page:one"));
    const adapter = createCoreLibraryModuleAdapter({ client, ...identity });

    await expect(adapter.apply({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId: "operation:archive",
      storeEpoch: identity.storeEpoch,
      operation: {
        kind: "archive_resource",
        target: {
          kind: "page",
          pageId: "page:one",
          expectedMetadataRevision: 1,
        },
      },
    })).resolves.toMatchObject({ ok: true, value: { operationKind: "archive_resource" } });

    await expect(adapter.apply({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId: "operation:restore",
      storeEpoch: identity.storeEpoch,
      operation: {
        kind: "restore_resource",
        target: {
          kind: "page",
          pageId: "page:one",
          expectedMetadataRevision: 2,
        },
      },
    })).resolves.toMatchObject({ ok: true, value: { operationKind: "restore_resource" } });

    expect(client.applies).toHaveLength(0);
    expect(client.blockRecordApplies.map((entry) => entry.operation.kind)).toEqual([
      "archive_subtree",
      "restore_subtree",
    ]);
    expect(client.blockRecordApplies[1]).toMatchObject({
      operation: {
        block_id: "page:one",
        target_parent: { kind: "library" },
        rank_key: "bfffffffffffffffffffffffffffffff",
        expected_block_revision: 1,
        expected_placement_revision: 1,
        placement_rebalances: [{
          block_id: "page:two",
          rank_key: "7fffffffffffffffffffffffffffffff",
          expected_revision: 9,
        }],
      },
    });
    expect(client.blockRecordReads[1]).toMatchObject({ include_archived: true });
  });

  test("routes trusted Library writes through the root Core client", async () => {
    const rootClient = new FakeCoreClient();
    rootClient.enqueueBlockRecordRead(emptyCanonicalPageWindow());
    rootClient.enqueueBlockRecordApply(canonicalPageCommit("operation:trusted", "page:trusted"));
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
    expect(rootClient.applies).toHaveLength(0);
    expect(rootClient.blockRecordApplies).toHaveLength(1);
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
