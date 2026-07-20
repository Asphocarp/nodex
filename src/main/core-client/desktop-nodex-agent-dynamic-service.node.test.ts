import { describe, expect, test, vi } from "vitest";
import {
  NODEX_APP_TOOL_NAMESPACE,
  NODEX_APP_V5_TOOLSET_REVISION,
} from "../../shared/nodex-agent-tools";
import {
  AdvancedUpdatePageV3InputSchema,
  UpdatePageV3InputSchema,
} from "../../shared/nodex-agent-tools/v3-write-schemas";
import type { NodexAgentDynamicExecutionContext } from "../agent-tools/dynamic-service-core";
import type {
  NodexAgentV3DocumentHub,
  NodexAgentV3Writer,
} from "../agent-tools/dynamic-service-v3";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import type { DesktopDatabaseModuleBridge } from "./desktop-database-module-bridge";
import type { DesktopDocumentSyncPort } from "./desktop-document-sync-bridge";
import { createDesktopNodexAgentV3DynamicService } from "./desktop-nodex-agent-dynamic-service";
import { NativeNodexAgentPageUpdateRuntime } from "./native-nodex-agent-page-update";
import type { DesktopProjectWorkspacePort } from "./project-workspace-adapter";

const unavailable = vi.fn(async () => {
  throw new Error("TypeScript Agent authority must not run");
});

const typescript = {
  writer: {
    readNodexAgentV3Tool: unavailable,
    prepareNodexAgentPageUpdate: unavailable,
    completeNodexAgentPageUpdate: unavailable,
    prepareNodexAgentCreatePages: unavailable,
    prepareNodexAgentDuplicatePage: unavailable,
    prepareNodexAgentMovePages: unavailable,
  } as unknown as NodexAgentV3Writer,
  documentHub: {
    applyDocumentMutation: unavailable,
    executeNodexAgentCreatePages: unavailable,
    executeNodexAgentDuplicatePage: unavailable,
    executeNodexAgentMovePages: unavailable,
  } as unknown as NodexAgentV3DocumentHub,
};

const documentSync = {
  coordinateNodexAgentLeasedMutation: async (options: {
    readonly execute: () => Promise<unknown>;
  }) => await options.execute(),
} as unknown as Pick<DesktopDocumentSyncPort, "coordinateNodexAgentLeasedMutation">;

const context = {
  threadId: "thread-native-agent",
  callId: "call-native-agent",
  authority: {
    threadId: "thread-native-agent",
    turnId: "turn-native-agent",
    rootThreadId: "thread-native-agent",
    actorProjectId: "project-native-agent",
    libraryId: "library-native-agent",
    storeEpoch: "store-native-agent",
    scope: "project",
    source: "project_turn",
  },
  access: {
    read: "allowed",
    write: "consent_required",
    domains: ["document", "placement", "database"],
  },
  resolveResourceAccess: async () => ({ kind: "authorized" as const }),
  authorize: async () => "deny" as const,
} satisfies NodexAgentDynamicExecutionContext;

describe("native desktop Nodex Agent dynamic service", () => {
  test("reads native Project and Database context without invoking TypeScript authority", async () => {
    const getProject = vi.fn(async () => ({
      id: "project-native-agent",
      libraryId: "library-native-agent",
      databaseId: "database-native-agent",
      lifecycle: "active" as const,
      bindingRevision: 3,
      name: "Native Project",
      description: "",
      sources: [],
      primaryWorkspaceRoot: null,
      pinned: false,
      pinnedOrder: null,
      created: new Date(0),
      updated: new Date(0),
    }));
    const readDatabase = vi.fn(async () => ({
      ok: true as const,
      value: {
        version: 2 as const,
        projectId: "project-native-agent",
        libraryId: "library-native-agent",
        storeEpoch: "store-native-agent",
        changeLogSeq: 9,
        value: {
          kind: "catalog" as const,
          databases: [{
            database: {
              databaseId: "database-native-agent",
              name: "Tasks",
            },
            dataSources: [{
              dataSourceId: "data-source-native-agent",
              name: "Tasks",
              schemaRevision: 4,
              lifecycle: "active",
            }],
            views: [{
              viewId: "view-native-agent",
              dataSourceId: "data-source-native-agent",
              name: "Board",
              kind: "kanban",
              isDefault: true,
              lifecycle: "active",
            }],
          }],
        },
      },
    }));
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve({ backend: "rust" } as DesktopDataAuthorityRuntime),
      projectWorkspace: { getProject } as unknown as DesktopProjectWorkspacePort,
      databaseModule: {
        read: readDatabase,
      } as unknown as DesktopDatabaseModuleBridge,
      documentSync,
      typescript,
    });

    const result = await service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "get_context",
    }, {
      include: { databases: true, markdownGuide: true },
    }, context);

    expect(result.output).toMatchObject({
      data: {
        project: {
          projectId: "project-native-agent",
          libraryId: "library-native-agent",
          boundDatabaseId: "database-native-agent",
        },
        databases: [{
          databaseId: "database-native-agent",
          isBound: true,
          dataSources: [{ dataSourceId: "data-source-native-agent" }],
          views: [{ viewId: "view-native-agent" }],
        }],
        markdownGuide: { format: "markdown" },
      },
    });
    expect(getProject).toHaveBeenCalledWith("project-native-agent");
    expect(readDatabase).toHaveBeenCalledOnce();
    expect(unavailable).not.toHaveBeenCalled();
  });

  test("fails closed for an unported native write instead of invoking TypeScript", async () => {
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve({ backend: "rust" } as DesktopDataAuthorityRuntime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync,
      typescript,
    });

    await expect(service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "create_pages",
    }, {
      destination: { kind: "library" },
      pages: [{ title: "Native" }],
    }, context)).rejects.toMatchObject({
      failure: {
        error: {
          code: "internal_error",
          retryable: false,
          details: { domainCode: "native_agent_tool_unavailable" },
        },
      },
    });
    expect(unavailable).not.toHaveBeenCalled();
  });

  test("duplicates a Page through Core only after coordinating its exact Document lease", async () => {
    let preparationCount = 0;
    const libraryRead = vi.fn(async (read: Record<string, unknown>) => {
      expect(read).toMatchObject({
        kind: "prepare_agent_page_copy",
        store_epoch: "store-native-agent",
        request: {
          source_page_id: "page-copy-source",
          destination: {
            kind: "page",
            page_id: "page-copy-target",
            at: { kind: "before", block_id: "block-copy-anchor" },
          },
          include_block_map: true,
          include_etags: true,
        },
        authorization: {
          call_id: "call-native-agent",
          provenance: {
            profile_id: "profile-native-agent",
          },
        },
      });
      preparationCount += 1;
      return {
        store_epoch: "store-native-agent",
        event_sequence: 20,
        value: {
          kind: "agent_page_copy_preparation" as const,
          value: {
            preparation: {
              state: "prepared" as const,
              consent: "none" as const,
              token: `copy-token-${preparationCount}`,
              expires_at_unix_ms: Date.now() + 30_000,
              footprint: {
                effect_class: "write" as const,
                targets: [],
                created_roots: ["page-copy-result"],
                updated_roots: [],
                deleted_roots: [],
                deleted_owner_roots: [],
                ownership_transformations: [],
              },
            },
            page_id: "page-copy-result",
            body_block_count: 2,
            document_heads: [{
              document_id: "document-copy-source",
              generation: 1,
              expected_head_seq: 5,
            }, {
              document_id: "document-copy-child",
              generation: 1,
              expected_head_seq: 2,
            }, {
              document_id: "document-copy-target",
              generation: 3,
              expected_head_seq: 8,
            }],
            destination: {
              kind: "page" as const,
              page_id: "page-copy-target",
              expected_document_generation: 3,
              expected_document_head_seq: 8,
              before: {
                block_id: "block-copy-anchor",
                expected_location_revision: 4,
              },
            },
            destination_document: {
              document_id: "document-copy-target",
              generation: 3,
              expected_head_seq: 8,
            },
            destination_database_id: null,
            destination_project_id: "project-native-agent",
            committed: null,
          },
        },
      };
    });
    const libraryApply = vi.fn(async (request: {
      readonly operationId: string;
      readonly intent: {
        readonly authorization: { readonly token?: string | null };
      };
    }) => {
      expect(request.operationId).toMatch(/^nodex-agent-duplicate:/u);
      expect(request.intent.authorization.token).toBe("copy-token-2");
      return {
        store_epoch: "store-native-agent",
        event_sequence: 21,
        receipt: {
          operation_id: request.operationId,
          duplicate: false,
        },
        value: {
          agent_page_copy: {
            source_page_id: "page-copy-source",
            page_id: "page-copy-result",
            location: { kind: "page" as const, page_id: "page-copy-target" },
            body_blocks_created: 2,
            block_map: {
              "page-copy-source": "page-copy-result",
              "block-copy-source": "block-copy-result",
            },
            etags: {
              title: "nxe1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              body: "nxe1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            },
            document_commits: [{
              document_id: "document-copy-target",
              generation: 3,
              base_head_seq: 8,
              head_seq: 9,
              update_id: "update-copy-target",
              update: [1, 2, 3],
              state_vector: [4, 5],
            }],
            affected_database_ids: [],
          },
        },
      };
    });
    const coordinate = vi.fn(async (options: {
      readonly projectId: string;
      readonly storeEpoch: string;
      readonly leaseDocuments: readonly {
        readonly documentId: string;
        readonly generation: number;
        readonly expectedHeadSeq: number;
      }[];
      readonly execute: () => Promise<unknown>;
    }) => {
      expect(options.projectId).toBe("project-native-agent");
      expect(options.storeEpoch).toBe("store-native-agent");
      expect(options.leaseDocuments).toEqual([{
        documentId: "document-copy-source",
        generation: 1,
        expectedHeadSeq: 5,
      }, {
        documentId: "document-copy-child",
        generation: 1,
        expectedHeadSeq: 2,
      }, {
        documentId: "document-copy-target",
        generation: 3,
        expectedHeadSeq: 8,
      }]);
      expect(libraryApply).not.toHaveBeenCalled();
      return await options.execute();
    });
    const runtime = {
      backend: "rust" as const,
      rootClient: {
        handshake: {
          profile_id: "profile-native-agent",
          library_id: "library-native-agent",
          store_epoch: "store-native-agent",
        },
      },
      clientForProject: () => ({ libraryRead, libraryApply }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve(runtime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync: {
        coordinateNodexAgentLeasedMutation: coordinate,
      } as unknown as Pick<DesktopDocumentSyncPort, "coordinateNodexAgentLeasedMutation">,
      typescript,
    });

    const result = await service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "duplicate_page",
    }, {
      pageId: "page-copy-source",
      destination: {
        kind: "page",
        pageId: "page-copy-target",
        at: { kind: "before", blockId: "block-copy-anchor" },
      },
      return: ["block_map", "etags"],
    }, context);

    expect(result).toMatchObject({
      effect: "write",
      output: {
        data: {
          sourcePageId: "page-copy-source",
          pageId: "page-copy-result",
          location: { kind: "page", pageId: "page-copy-target" },
          bodyBlocksCreated: 2,
          blockMap: {
            "page-copy-source": "page-copy-result",
            "block-copy-source": "block-copy-result",
          },
          etags: {
            title: "nxe1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            body: "nxe1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          },
        },
      },
    });
    expect(libraryRead).toHaveBeenCalledTimes(2);
    expect(coordinate).toHaveBeenCalledOnce();
    expect(libraryApply).toHaveBeenCalledOnce();
    expect(unavailable).not.toHaveBeenCalled();
  });

  test("searches native Library resources with Core authority and pagination", async () => {
    const libraryRead = vi.fn(async () => ({
      value: {
        kind: "agent_search" as const,
        items: [{
          kind: "page" as const,
          id: "page-native-search",
          title: "Native Search",
          location: {
            kind: "data_source" as const,
            data_source_id: "data-source-native-agent",
          },
          matches: [{
            source: "property" as const,
            quality: "fuzzy" as const,
            property_id: "p_Abcd1234",
            property_name: "Status",
            excerpt: "In progress",
          }],
        }],
        has_more: true,
        next_cursor: "nxl1.search.signature",
      },
    }));
    const runtime = {
      backend: "rust" as const,
      rootClient: {
        handshake: { profile_id: "profile-native-agent" },
      },
      clientForProject: () => ({ libraryRead }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve(runtime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync,
      typescript,
    });

    const result = await service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "search",
    }, {
      query: "nativ serch",
      scope: { kind: "data_source", dataSourceId: "data-source-native-agent" },
      page: { cursor: "nxl1.previous.signature", limit: 1 },
    }, context);

    expect(result.output).toEqual({
      data: {
        results: [{
          kind: "page",
          id: "page-native-search",
          title: "Native Search",
          location: {
            kind: "data_source",
            dataSourceId: "data-source-native-agent",
          },
          matches: [{
            source: "property",
            quality: "fuzzy",
            propertyId: "p_Abcd1234",
            propertyName: "Status",
            excerpt: "In progress",
          }],
        }],
      },
      page: { hasMore: true, nextCursor: "nxl1.search.signature" },
    });
    expect(libraryRead).toHaveBeenCalledWith(expect.objectContaining({
      kind: "agent_search",
      query: "nativ serch",
      target: "pages",
      scope: {
        kind: "data_source",
        data_source_id: "data-source-native-agent",
      },
      cursor: "nxl1.previous.signature",
      limit: 1,
      authorization: expect.objectContaining({ call_id: "call-native-agent" }),
    }));
    expect(unavailable).not.toHaveBeenCalled();
  });

  test("fetches native stable Blocks with Core-minted guards and pagination", async () => {
    const ownerPage = {
      version: 2,
      library_id: "library-native-agent",
      store_epoch: "store-native-agent",
      change_log_seq: 12,
      page: {
        pageId: "page-fetch",
        parent: { kind: "data_source", dataSourceId: "source-fetch" },
      },
      document: {
        readiness: "ready",
        schema_key: "nodex.page",
        schema_version: 2,
      },
      intrinsic_properties: [{
        key: "status",
        value_type: "string",
        value: "todo",
        revision: 3,
      }],
      data_source_context: {
        kind: "member" as const,
        membership: {
          membership_id: "membership-fetch",
          data_source_id: "source-fetch",
          revision: 4,
          created_at: "2026-07-20T00:00:00.000Z",
        },
        database: { databaseId: "database-fetch" },
        data_source: { dataSourceId: "source-fetch" },
        properties: [],
        values: {
          "p_Abcd1234": { value: "high" },
        },
      },
      access_context: { kind: "library" as const },
    };
    const libraryRead = vi.fn(async (read: { readonly kind: string }) => {
      if (read.kind === "agent_block_target") {
        return {
          value: {
            kind: "agent_block_target" as const,
            value: {
              block_id: "page-fetch",
              block_type: "page",
              lifecycle: "active",
              owner_page_id: "page-fetch",
              document_id: "document-fetch",
              document_generation: 2,
              document_head_seq: 7,
              owner_page: ownerPage,
            },
          },
        };
      }
      throw new Error(`Unexpected Library read ${read.kind}`);
    });
    const documentRead = vi.fn(async (
      clientSessionId: string,
      read: Record<string, unknown>,
    ) => {
      expect(clientSessionId).toBe("nodex-agent:thread-native-agent");
      expect(read).toMatchObject({
        kind: "agent_semantic_snapshot",
        document_id: "document-fetch",
        target_block_id: "page-fetch",
        prepare_title: true,
        prepare_body: false,
        block_guards: [{ block_id: "block-fetch", kind: "update" }],
        max_depth: 3,
        limit: 1,
      });
      return {
        value: {
          kind: "agent_semantic_snapshot" as const,
          snapshot: {
            document_id: "document-fetch",
            generation: 2,
            head_seq: 7,
            owner_block_id: "page-fetch",
            target_block_id: "page-fetch",
            title: "Fetch",
            rich_title: [{ type: "text", text: "Fetch", styles: {} }],
            nested_markdown: "Fetched body",
            plain_text: "Fetched body",
            blocks: [{
              block_id: "block-fetch",
              parent_block_id: null,
              sibling_index: 0,
              depth: 0,
              block_type: "paragraph",
              props: {},
              content: [{ type: "text", text: "Fetched body", styles: {} }],
              etag: "nxe1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            }],
            title_etag: "nxe1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            has_more: true,
            next_cursor: "nxd1.cursor.signature",
          },
        },
      };
    });
    const runtime = {
      backend: "rust" as const,
      rootClient: {
        handshake: { profile_id: "profile-native-agent" },
      },
      clientForProject: () => ({ libraryRead, documentRead }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve(runtime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync,
      typescript,
    });

    const result = await service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "fetch",
    }, {
      id: "page-fetch",
      format: "blocks",
      maxDepth: 3,
      page: { limit: 1 },
      propertyIds: ["status", "p_Abcd1234"],
      prepareFor: [
        { kind: "title" },
        { kind: "block_update", blockIds: ["block-fetch"] },
      ],
    }, context);

    expect(result.output).toMatchObject({
      data: {
        resource: {
          id: "page-fetch",
          title: {
            markdown: "Fetch",
            etag: "nxe1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          },
          location: { kind: "data_source", dataSourceId: "source-fetch" },
          properties: {
            status: { value: "todo" },
            "p_Abcd1234": { value: "high" },
          },
        },
        content: {
          format: "blocks",
          blocks: [{
            id: "block-fetch",
            etag: "nxe1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          }],
        },
        dataSource: {
          dataSourceId: "source-fetch",
          databaseId: "database-fetch",
        },
      },
      page: { hasMore: true, nextCursor: "nxd1.cursor.signature" },
    });
    expect(libraryRead).toHaveBeenCalledOnce();
    expect(documentRead).toHaveBeenCalledOnce();
    expect(unavailable).not.toHaveBeenCalled();
  });

  test("queries native Data Sources with exact Agent authority and Core pagination", async () => {
    const databaseRead = vi.fn(async () => ({
      store_epoch: "store-native-agent",
      event_head: 13,
      value: {
        kind: "agent_query" as const,
        value: {
          database: {
            databaseId: "database-native-agent",
            libraryId: "library-native-agent",
            name: "Tasks",
            lifecycle: "active",
            defaultViewId: null,
            accessRevision: 1,
            metadataRevision: 1,
            createdAt: "2026-07-20T00:00:00.000Z",
            updatedAt: "2026-07-20T00:00:00.000Z",
          },
          dataSource: {
            dataSourceId: "data-source-native-agent",
            libraryId: "library-native-agent",
            homeDatabaseId: "database-native-agent",
            name: "Tasks",
            schemaKey: "nodex.data-source",
            schemaRevision: 4,
            lifecycle: "active",
            rankKey: "a",
            createdAt: "2026-07-20T00:00:00.000Z",
            updatedAt: "2026-07-20T00:00:00.000Z",
          },
          properties: [],
          rows: [],
        },
        has_more: true,
        next_cursor: "nxl1.query.signature",
      },
    }));
    const runtime = {
      backend: "rust" as const,
      rootClient: {
        handshake: { profile_id: "profile-native-agent" },
      },
      clientForProject: () => ({ databaseRead }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve(runtime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync,
      typescript,
    });

    const result = await service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "query_data_source",
    }, {
      dataSourceId: "data-source-native-agent",
      page: { limit: 25 },
    }, context);

    expect(result.output).toMatchObject({
      data: {
        database: { databaseId: "database-native-agent", name: "Tasks" },
        dataSource: {
          dataSourceId: "data-source-native-agent",
          name: "Tasks",
          properties: [],
        },
        rows: [],
      },
      page: { hasMore: true, nextCursor: "nxl1.query.signature" },
    });
    expect(databaseRead).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        kind: "agent_data_source",
        data_source_id: "data-source-native-agent",
        query: expect.objectContaining({
          authorization: expect.objectContaining({
            call_id: "call-native-agent",
          }),
          limit: 25,
        }),
      }),
      mode: "query",
    }));
    expect(unavailable).not.toHaveBeenCalled();
  });

  test("commits exact Page patches through prepared native Document authority", async () => {
    let committed = false;
    let preparation = 0;
    const pageContent = () => ({
      store_epoch: "store-native-agent",
      event_sequence: committed ? 10 : 9,
      value: {
        kind: "page_content" as const,
        value: {
          page_id: "page-update",
          library_id: "library-native-agent",
          document_id: "document-update",
          document_generation: 1,
          document_head_seq: committed ? 8 : 7,
          body_nfm: committed ? "New New" : "Old Old",
        },
      },
    });
    const libraryRead = vi.fn(async () => pageContent());
    const documentRead = vi.fn(async (
      _clientSessionId: string,
      read: {
        mutation: { commands: readonly unknown[] };
      },
    ) => {
      preparation += 1;
      expect(read.mutation.commands).toEqual([{
        kind: "patch_body",
        old_fragment: "Old",
        new_fragment: "New",
        expected_matches: 2,
      }]);
      return {
        store_epoch: "store-native-agent",
        event_sequence: 9,
        value: {
          kind: "agent_semantic_mutation_preparation" as const,
          preparation: {
            state: "prepared" as const,
            consent: "none" as const,
            expires_at_unix_ms: Date.now() + 30_000,
            token: `token-${preparation}`,
            footprint: {
              effect_class: "destructive" as const,
              targets: [{ kind: "page" as const, page_id: "page-update" }],
              created_roots: ["block-created"],
              updated_roots: ["page-update"],
              deleted_roots: ["block-deleted"],
              deleted_owner_roots: [],
              ownership_transformations: [],
            },
          },
        },
      };
    });
    const documentApply = vi.fn(async (request: {
      intent: {
        authorization: { token?: string | null };
        mutation: { commands: readonly unknown[] };
      };
    }) => {
      expect(request.intent.authorization.token).toBe("token-2");
      expect(request.intent.mutation.commands).toEqual([{
        kind: "patch_body",
        old_fragment: "Old",
        new_fragment: "New",
        expected_matches: 2,
      }]);
      committed = true;
      return {
        store_epoch: "store-native-agent",
        event_sequence: 10,
        receipt: {
          operation_id: "agent-update",
          duplicate: false,
          document_id: "document-update",
          generation: 1,
          head_seq: 8,
        },
        value: {
          document_id: "document-update",
          generation: 1,
          head_seq: 8,
          outcome: "committed" as const,
          committed_at: "2026-07-20T00:00:00.000Z",
          mutation_effect: {
            base_head_seq: 7,
            touched_block_ids: ["block-created", "block-deleted"],
            created_block_ids: ["block-created"],
            deleted_block_ids: ["block-deleted"],
            updated_block_ids: [],
            moved_block_ids: [],
            write_fence_block_ids: [],
            title_changed: false,
            coordination: "merge_friendly" as const,
          },
          semantic_etags: {
            title: "nxe1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            body: "nxe1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          },
        },
      };
    });
    const runtime = {
      backend: "rust" as const,
      rootClient: {
        handshake: {
          profile_id: "profile-native-agent",
          library_id: "library-native-agent",
          store_epoch: "store-native-agent",
        },
        libraryRead,
      },
      clientForProject: () => ({ documentRead, documentApply }),
    } as unknown as DesktopDataAuthorityRuntime;
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve(runtime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync,
      typescript,
    });

    const result = await service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "update_page",
    }, {
      pageId: "page-update",
      body: {
        kind: "patch",
        patches: [{
          oldMarkdown: "Old",
          newMarkdown: "New",
          expectedMatches: 2,
        }],
      },
      return: ["markdown", "block_ids", "etags"],
    }, context);

    expect(result).toMatchObject({
      effect: "write",
      output: {
        data: {
          pageId: "page-update",
          effects: {
            created: 1,
            updated: 0,
            moved: 0,
            deleted: 1,
            blockIds: {
              created: ["block-created"],
              updated: [],
              deleted: ["block-deleted"],
            },
          },
          etags: {
            title: "nxe1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            body: "nxe1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          },
          body: { format: "markdown", markdown: "New New" },
        },
      },
    });
    expect(documentRead).toHaveBeenCalledTimes(2);
    expect(documentApply).toHaveBeenCalledOnce();
    expect(libraryRead).toHaveBeenCalledTimes(3);
    expect(unavailable).not.toHaveBeenCalled();
  });

  test("maps Page insertion anchors and uses Core canonical preview Markdown", async () => {
    const documentRead = vi.fn(async () => ({
      store_epoch: "store-native-agent",
      event_sequence: 9,
      value: {
        kind: "agent_semantic_mutation_preparation" as const,
        preparation: {
          state: "prepared" as const,
          consent: "none" as const,
          token: "insert-token",
          preview_markdown: "Current\n\nInserted",
          footprint: {
            effect_class: "write" as const,
            targets: [{ kind: "page" as const, page_id: "page-insert" }],
            created_roots: ["block-inserted"],
            updated_roots: ["page-insert"],
            deleted_roots: [],
            deleted_owner_roots: [],
            ownership_transformations: [],
          },
        },
      },
    }));
    const runtime = {
      backend: "rust" as const,
      rootClient: {
        handshake: { profile_id: "profile-native-agent" },
        libraryRead: vi.fn(async () => ({
          value: {
            kind: "page_content" as const,
            value: {
              document_id: "document-insert",
              document_generation: 1,
              document_head_seq: 4,
              body_nfm: "Current",
            },
          },
        })),
      },
      clientForProject: () => ({ documentRead }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const updates = new NativeNodexAgentPageUpdateRuntime(runtime);
    const input = UpdatePageV3InputSchema.parse({
      pageId: "page-insert",
      body: {
        kind: "insert",
        at: { kind: "after", blockId: "block-anchor" },
        markdown: "Inserted",
      },
      return: ["block_ids"],
    });

    const prepared = await updates.prepare({
      tool: "update_page",
      threadId: context.threadId,
      callId: "call-insert",
      projectId: context.authority.actorProjectId,
      authority: context.authority,
      input,
    });

    expect(documentRead).toHaveBeenCalledWith(
      "nodex-agent:thread-native-agent",
      expect.objectContaining({
        mutation: expect.objectContaining({
          commands: [{
            kind: "insert_body",
            anchor: { kind: "after", block_id: "block-anchor" },
            nested_markdown: "Inserted",
          }],
        }),
      }),
    );
    expect(prepared.result).toMatchObject({
      ok: true,
      value: {
        kind: "prepared",
        targetMarkdown: "Current\n\nInserted",
        effects: { createdBlockIds: ["block-inserted"] },
      },
    });
  });

  test("maps guarded stable-Block batches into native semantic commands", async () => {
    const documentRead = vi.fn(async () => ({
      store_epoch: "store-native-agent",
      event_sequence: 9,
      value: {
        kind: "agent_semantic_mutation_preparation" as const,
        preparation: {
          state: "prepared" as const,
          consent: "none" as const,
          token: "stable-token",
          preview_markdown: "Stable preview",
          footprint: {
            effect_class: "destructive" as const,
            targets: [{ kind: "page" as const, page_id: "page-stable" }],
            created_roots: ["block-created", "block-created-child"],
            updated_roots: ["block-update", "block-move"],
            deleted_roots: ["block-delete"],
            deleted_owner_roots: ["block-delete"],
            ownership_transformations: [{
              resource_id: "block-move",
              parent_id: "block-parent",
              before_id: null,
            }],
          },
        },
      },
    }));
    const documentApply = vi.fn(async () => ({
      store_epoch: "store-native-agent",
      event_sequence: 10,
      receipt: {
        operation_id: "agent-stable",
        duplicate: false,
        document_id: "document-stable",
        generation: 2,
        head_seq: 9,
      },
      value: {
        document_id: "document-stable",
        generation: 2,
        head_seq: 9,
        outcome: "committed" as const,
        committed_at: "2026-07-20T00:00:00.000Z",
        mutation_effect: {
          base_head_seq: 8,
          touched_block_ids: [
            "block-created",
            "block-created-child",
            "block-update",
            "block-move",
            "block-delete",
          ],
          created_block_ids: ["block-created", "block-created-child"],
          deleted_block_ids: ["block-delete"],
          updated_block_ids: ["block-update"],
          moved_block_ids: ["block-move"],
          write_fence_block_ids: ["block-delete"],
          title_changed: false,
          coordination: "write_fence" as const,
        },
        semantic_local_block_ids: {
          "draft-root": "block-created",
          "draft-child": "block-created-child",
        },
      },
    }));
    const runtime = {
      backend: "rust" as const,
      rootClient: {
        handshake: { profile_id: "profile-native-agent" },
        libraryRead: vi.fn(async () => ({
          value: {
            kind: "page_content" as const,
            value: {
              document_id: "document-stable",
              document_generation: 2,
              document_head_seq: 8,
              body_nfm: "Before",
            },
          },
        })),
      },
      clientForProject: () => ({ documentRead, documentApply }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const updates = new NativeNodexAgentPageUpdateRuntime(runtime);
    const input = AdvancedUpdatePageV3InputSchema.parse({
      pageId: "page-stable",
      edits: [{
        kind: "insert",
        at: { kind: "before", blockId: "block-anchor" },
        block: {
          localId: "draft-root",
          type: "paragraph",
          props: { textAlignment: "left" },
          content: [{ type: "text", text: "Draft", styles: {} }],
          children: [{ localId: "draft-child", type: "divider" }],
        },
      }, {
        kind: "update",
        blockId: "block-update",
        ifMatch: "nxe1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        patch: { type: "heading", content: null },
      }, {
        kind: "move",
        blockId: "block-move",
        at: { kind: "end", parentBlockId: "block-parent" },
      }, {
        kind: "delete",
        blockId: "block-delete",
        ifMatch: "nxe1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      }],
      safety: { allowDeletingOwnedBlocks: true },
      return: ["block_ids"],
    });

    const prepared = await updates.prepare({
      tool: "advanced_update_page",
      threadId: context.threadId,
      callId: "call-stable",
      projectId: context.authority.actorProjectId,
      authority: context.authority,
      input,
    });

    expect(documentRead).toHaveBeenCalledWith(
      "nodex-agent:thread-native-agent",
      expect.objectContaining({
        mutation: expect.objectContaining({
          allow_deleting_owned_blocks: true,
          commands: [{
            kind: "insert_block",
            anchor: { kind: "before", block_id: "block-anchor" },
            block: {
              local_id: "draft-root",
              block_type: "paragraph",
              props: { textAlignment: "left" },
              content: {
                kind: "value",
                value: [{ type: "text", text: "Draft", styles: {} }],
              },
              children: [{
                local_id: "draft-child",
                block_type: "divider",
                props: {},
                content: { kind: "absent" },
                children: [],
              }],
            },
          }, {
            kind: "update_block",
            block_id: "block-update",
            expected_etag: "nxe1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            patch: {
              block_type: "heading",
              content: { kind: "value", value: null },
              unset_content: false,
            },
          }, {
            kind: "move_block",
            block_id: "block-move",
            anchor: { kind: "end", parent_block_id: "block-parent" },
          }, {
            kind: "delete_block",
            block_id: "block-delete",
            expected_etag: "nxe1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          }],
        }),
      }),
    );
    expect(prepared.result).toMatchObject({
      ok: true,
      value: {
        kind: "prepared",
        targetMarkdown: "Stable preview",
        effects: {
          createdBlockIds: ["block-created", "block-created-child"],
          movedBlockIds: ["block-move"],
          deletedBlockIds: ["block-delete"],
          deletedOwnerBlockIds: ["block-delete"],
        },
      },
    });
    if (!prepared.result.ok || prepared.result.value.kind !== "prepared") {
      throw new Error("Stable Block update was not prepared");
    }
    const applied = await updates.apply(prepared.result.value.mutation);
    if (!applied.ok) throw new Error(applied.error.message);
    const completed = await updates.complete({
      tool: "advanced_update_page",
      threadId: context.threadId,
      callId: "call-stable",
      projectId: context.authority.actorProjectId,
      authority: context.authority,
      pageId: "page-stable",
      result: applied.value,
    });
    expect(completed.result).toMatchObject({
      ok: true,
      output: {
        data: {
          effects: {
            blockIds: {
              local: {
                "draft-root": "block-created",
                "draft-child": "block-created-child",
              },
            },
          },
        },
      },
    });
    expect(documentApply).toHaveBeenCalledWith(expect.objectContaining({
      intent: expect.objectContaining({
        authorization: expect.objectContaining({ token: "stable-token" }),
      }),
    }));
  });
});
