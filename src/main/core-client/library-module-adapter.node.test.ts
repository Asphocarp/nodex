import { describe, expect, test } from "vitest";

import { plainTextToPortableRichText } from "../../shared/block-documents";
import { LIBRARY_MODULE_CONTRACT_VERSION } from "../../shared/library-module";
import { PAGE_HISTORY_CONTRACT_VERSION } from "../../shared/page-history";
import { FakeCoreClient } from "./testing/fake-core-client";
import { createCoreLibraryModuleAdapter } from "./library-module-adapter";
import {
  createDesktopLibraryModuleBridge,
  mapCoreLibraryEvent,
  type DesktopLibraryModuleBridgeInput,
} from "./desktop-library-module-bridge";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";

const identity = {
  libraryId: "library:test",
  profileId: "profile:test",
  storeEpoch: "epoch:test",
} as const;

const pageDetailSnapshot = () => ({
  version: 1 as const,
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
  version: 1 as const,
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
  version: 1 as const,
  store_epoch: identity.storeEpoch,
  event_head: 13,
  value: {
    kind: "project_page_search" as const,
    items: [{
      project_id: "project:test",
      page_id: "page:one",
      status: "build" as const,
      score: 1_000_000,
      excerpt: "Page search evidence",
    }],
  },
});

const neverTypeScript = (): DesktopLibraryModuleBridgeInput["typescript"] => ({
  read: async () => {
    throw new Error("TypeScript read must not run");
  },
  apply: async () => {
    throw new Error("TypeScript apply must not run");
  },
  readProjectPageDetail: async () => {
    throw new Error("TypeScript Project Page Detail must not run");
  },
  readLibraryPageDetail: async () => {
    throw new Error("TypeScript Library Page Detail must not run");
  },
  listPageHistory: async () => {
    throw new Error("TypeScript Page history must not run");
  },
  searchPages: async () => {
    throw new Error("TypeScript Page search must not run");
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
      rootClient: Object.assign(rootClient, {
        handshake: {
          library_id: identity.libraryId,
          profile_id: identity.profileId,
          store_epoch: identity.storeEpoch,
        },
      }),
      clientForProject: (projectId: string) => {
        requestedProjects.push(projectId);
        return projectClient;
      },
    } as unknown as RustDataAuthorityRuntime;
    const bridge = createDesktopLibraryModuleBridge({
      authority: Promise.resolve(runtime),
      resolveProjectId: () => null,
      typescript: neverTypeScript(),
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
      version: 1,
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
        version: 1,
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

  test("maps a committed aggregate and rejects a stale epoch before Core", async () => {
    const client = new FakeCoreClient();
    client.enqueueApply({
      value: { affected_resource_ids: ["page:one"], page_copy: null },
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

  test("fails closed before a Rust write without a trusted window Project", async () => {
    let typescriptApplyCalled = false;
    const runtime = {
      backend: "rust",
      rootClient: { handshake: {
        library_id: identity.libraryId,
        profile_id: identity.profileId,
        store_epoch: identity.storeEpoch,
      } },
      clientForProject: () => {
        throw new Error("Project client must not be resolved");
      },
    } as unknown as RustDataAuthorityRuntime;
    const bridge = createDesktopLibraryModuleBridge({
      authority: Promise.resolve(runtime),
      resolveProjectId: () => null,
      typescript: {
        ...neverTypeScript(),
        apply: async () => {
          typescriptApplyCalled = true;
          throw new Error("TypeScript apply must not run");
        },
      },
    });

    await expect(bridge.apply({
      version: 1,
      operationId: "operation:unbound",
      storeEpoch: identity.storeEpoch,
      operation: {
        kind: "create_page",
        pageId: "page:unbound",
        documentId: "document:unbound",
        title: "Unbound",
        parent: { kind: "library" },
      },
    }, {})).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(typescriptApplyCalled).toBe(false);
  });

  test("maps only Library Core events into renderer invalidations", () => {
    expect(mapCoreLibraryEvent({
      protocol_version: 1,
      event: {
        version: 1,
        sequence: 9,
        store_epoch: identity.storeEpoch,
        operation_id: "operation:create",
        committed_at: "2026-07-19T15:02:00.000Z",
        payload: {
          module: "library",
          event: {
            kind: "library_changed",
            page_ids: ["page:one"],
            database_ids: ["database:one"],
            parent_keys: ["library"],
          },
        },
      },
    }, identity.libraryId)).toEqual({
      version: 1,
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
