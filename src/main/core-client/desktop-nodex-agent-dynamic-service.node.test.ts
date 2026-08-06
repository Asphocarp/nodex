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
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import type { DesktopDatabaseModuleBridge } from "./desktop-database-module-bridge";
import type { DesktopDocumentSyncPort } from "./desktop-document-sync-bridge";
import { createDesktopNodexAgentV3DynamicService } from "./desktop-nodex-agent-dynamic-service";
import { NativeNodexAgentPageUpdateRuntime } from "./native-nodex-agent-page-update";
import type { DesktopProjectWorkspacePort } from "./project-workspace-adapter";
import {
  createFakeCoreHandshake,
} from "./testing/fake-core-client";
import type { BlockRecordCommittedValue, BlockRecordReadSnapshot } from "./types";
import type { BlockRecordApplyInput } from "./types";
import { canonicalAgentBlockEtag } from "./canonical-agent-etag";

const nativeAgentIdentity = {
  profileId: "profile-native-agent",
  libraryId: "library-native-agent",
  storeEpoch: "store-native-agent",
} as const;

const nativeAgentHandshake = () => createFakeCoreHandshake(nativeAgentIdentity);

const documentSync = {
  executeNodexAgentMutation: async (options: {
    readonly execute: () => Promise<unknown>;
  }) => await options.execute(),
} as unknown as Pick<DesktopDocumentSyncPort, "executeNodexAgentMutation">;

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

interface TestBodyBlock {
  readonly id: string;
  readonly type: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly text?: string;
  readonly parentId?: string;
}

const pageWindow = (
  pageId: string,
  body: readonly TestBodyBlock[],
  commitSeq: number,
): BlockRecordReadSnapshot => {
  const blocks = [{
    id: pageId,
    library_id: nativeAgentIdentity.libraryId,
    kind: "page" as const,
    lifecycle: "active" as const,
    properties: { title: pageId },
    content_shard_id: `shard:${pageId}`,
    revision: 0,
  }, ...body.map((block) => ({
    id: block.id,
    library_id: nativeAgentIdentity.libraryId,
    kind: block.type,
    lifecycle: "active" as const,
    properties: block.props ?? {},
    content_shard_id: `shard:${block.id}`,
    revision: 0,
  }))];
  const placements = [{
    block_id: pageId,
    parent: { kind: "library" as const },
    rank_key: "a",
    revision: 0,
  }, ...body.map((block, index) => ({
    block_id: block.id,
    parent: { kind: "block" as const, id: block.parentId ?? pageId },
    rank_key: String.fromCharCode(97 + index),
    revision: 0,
  }))];
  return {
    library_id: nativeAgentIdentity.libraryId,
    observed_cursor: {
      store_epoch: nativeAgentIdentity.storeEpoch,
      commit_seq: commitSeq,
    },
    graph: {
      library_id: nativeAgentIdentity.libraryId,
      blocks,
      placements,
    },
    view_positions: [],
    content: [{
      block_id: pageId,
      library_id: nativeAgentIdentity.libraryId,
      slot: "title",
      shard_id: `shard:${pageId}`,
      revision: 0,
      materialized_json: [{ type: "text", text: pageId, styles: {} }],
      full_state_v1: [],
      state_vector_v1: [],
      state_hash: "a".repeat(64),
    }, ...body.map((block) => ({
      block_id: block.id,
      library_id: nativeAgentIdentity.libraryId,
      slot: block.type === "page" ? "title" as const : "inline" as const,
      shard_id: `shard:${block.id}`,
      revision: 0,
      materialized_json: block.text === undefined
        ? []
        : [{ type: "text", text: block.text, styles: {} }],
      full_state_v1: [],
      state_vector_v1: [],
      state_hash: "b".repeat(64),
    }))],
  };
};

const committedBlockRecord = (
  operationId: string,
  commitSeq: number,
): BlockRecordCommittedValue => ({
  actor_id: "profile:profile-native-agent",
      audience: { kind: "projects", project_ids: ["project-native-agent"] },
  canonical_hash: "c".repeat(64),
  commit_id: `commit:${operationId}`,
  committed_at: "2026-07-20T00:00:00.000Z",
  cursor: { store_epoch: nativeAgentIdentity.storeEpoch, commit_seq: commitSeq },
  duplicate: false,
  effects: [],
  intent_hash: "d".repeat(64),
  operation_id: operationId,
  payload_completeness: "rich",
  session_id: "nodex-agent:thread-native-agent",
});

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
          kind: "database" as const,
          value: {
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
          },
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
  });

  test("creates a Page batch through canonical BlockRecord authority", async () => {
    let preparationCount = 0;
    const libraryRead = vi.fn(async (read: Record<string, unknown>) => {
      expect(read).toMatchObject({
        kind: "prepare_agent_create_pages",
        store_epoch: "store-native-agent",
        request: {
          destination: {
            kind: "page",
            page_id: "page-create-target",
            at: { kind: "end" },
          },
          pages: [{
            title_markdown: "**First**",
            nfm: "Body one",
            values: [],
          }, {
            title_markdown: "Second",
            nfm: "Body two",
            values: [],
          }],
          include_block_ids: true,
          include_etags: true,
        },
      });
      preparationCount += 1;
      return {
        store_epoch: "store-native-agent",
        event_sequence: 30,
        value: {
          kind: "agent_create_pages_preparation" as const,
          value: {
            preparation: {
              state: "prepared" as const,
              consent: "none" as const,
              token: `create-token-${preparationCount}`,
              expires_at_unix_ms: Date.now() + 30_000,
              footprint: {
                effect_class: "write" as const,
                targets: [],
                created_roots: ["page-created-1", "page-created-2"],
                updated_roots: [],
                deleted_roots: [],
                deleted_owner_roots: [],
                ownership_transformations: [],
              },
            },
            pages: [{
              page_id: "page-created-1",
              body_block_ids: ["body-created-1"],
              primary_membership_id: "membership-primary-1",
              target_membership_id: "membership-target-1",
            }, {
              page_id: "page-created-2",
              body_block_ids: ["body-created-2"],
              primary_membership_id: "membership-primary-2",
              target_membership_id: "membership-target-2",
            }],
            document_heads: [{
              document_id: "document-create-target",
              generation: 2,
              expected_head_seq: 4,
            }],
            destination: {
              kind: "page" as const,
              page_id: "page-create-target",
              expected_document_generation: 2,
              expected_document_head_seq: 4,
              before: null,
            },
            destination_document: {
              document_id: "document-create-target",
              generation: 2,
              expected_head_seq: 4,
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
      expect(request.operationId).toMatch(/^nodex-agent-create-pages:/u);
      expect(request.intent.authorization.token).toBe("create-token-2");
      return {
        event_sequence: 33,
        receipt: {
          operation_id: request.operationId,
          duplicate: false,
        },
        value: {
          agent_create_pages: {
            pages: [{
              page_id: "page-created-1",
              location: { kind: "page" as const, page_id: "page-create-target" },
              body_blocks_created: 1,
              block_ids: ["body-created-1"],
              etags: {
                title: "nxe1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                body: "nxe1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
              },
            }, {
              page_id: "page-created-2",
              location: { kind: "page" as const, page_id: "page-create-target" },
              body_blocks_created: 1,
              block_ids: ["body-created-2"],
              etags: {
                title: "nxe1.CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
                body: "nxe1.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
              },
            }],
            document_commits: [{
              document_id: "document-create-target",
              generation: 2,
              base_head_seq: 4,
              head_seq: 5,
              update_id: "create-target-1",
              update: [1],
              state_vector: [2],
            }, {
              document_id: "document-create-target",
              generation: 2,
              base_head_seq: 5,
              head_seq: 6,
              update_id: "create-target-2",
              update: [3],
              state_vector: [4],
            }],
            affected_database_ids: [],
          },
        },
      };
    });
    const blockRecordRead = vi.fn(async () => ({
      library_id: "library-native-agent",
      observed_cursor: { store_epoch: "store-native-agent", commit_seq: 29 },
      graph: {
        library_id: "library-native-agent",
        blocks: [{
          id: "page-create-target",
          library_id: "library-native-agent",
          kind: "page",
          lifecycle: "active",
          properties: { title: "Target" },
          content_shard_id: "shard:target",
          revision: 1,
        }],
        placements: [{
          block_id: "page-create-target",
          parent: { kind: "library" },
          rank_key: "a",
          revision: 1,
        }],
      },
      view_positions: [],
      content: [],
    }));
    const blockRecordApply = vi.fn(async (request: {
      readonly operation: { readonly kind: string; readonly operations?: readonly unknown[] };
      readonly operation_id: string;
      readonly agent_authorization?: { readonly call_id: string };
    }) => {
      expect(request.operation.kind).toBe("batch");
      expect(request.operation.operations).toHaveLength(4);
      expect(request.agent_authorization).toMatchObject({ call_id: "call-native-agent" });
      return {
        actor_id: "profile:library-native-agent",
        audience: { kind: "library", projectIds: [] },
        canonical_hash: "a".repeat(64),
        commit_id: `commit:${request.operation_id}`,
        committed_at: "2026-08-06T00:00:00.000Z",
        cursor: { store_epoch: "store-native-agent", commit_seq: 34 },
        duplicate: false,
        effects: [],
        intent_hash: "b".repeat(64),
        operation_id: request.operation_id,
        payload_completeness: "rich" as const,
        session_id: "call-native-agent",
      };
    });
    const coordinate = vi.fn(async (options: {
      readonly execute: () => Promise<unknown>;
    }) => await options.execute());
    const runtime = {
      backend: "rust" as const,
      identity: nativeAgentIdentity,
      rootClient: {
        handshake: nativeAgentHandshake(),
      },
      clientForProject: () => ({ libraryRead, libraryApply, blockRecordRead, blockRecordApply }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve(runtime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync: {
        executeNodexAgentMutation: coordinate,
      } as unknown as Pick<DesktopDocumentSyncPort, "executeNodexAgentMutation">,
    });

    const result = await service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "create_pages",
    }, {
      destination: {
        kind: "page",
        pageId: "page-create-target",
        at: { kind: "end" },
      },
      pages: [{ title: "**First**", markdown: "Body one" }, {
        title: "Second",
        markdown: "Body two",
      }],
      return: ["block_ids", "etags"],
    }, context);

    expect(result.output).toMatchObject({
      data: {
        created: 2,
        pages: [{
          pageId: expect.stringMatching(/^agent-page:/u),
          location: { kind: "page", pageId: "page-create-target" },
          blockIds: [expect.stringMatching(/^agent-block:/u)],
        }, {
          pageId: expect.stringMatching(/^agent-page:/u),
          location: { kind: "page", pageId: "page-create-target" },
          blockIds: [expect.stringMatching(/^agent-block:/u)],
        }],
      },
    });
    expect(libraryRead).not.toHaveBeenCalled();
    expect(coordinate).toHaveBeenCalledOnce();
    expect(libraryApply).not.toHaveBeenCalled();
    expect(blockRecordApply).toHaveBeenCalledOnce();
  });

  test("moves a mixed-source Page batch through one canonical commit", async () => {
    let preparationCount = 0;
    const libraryRead = vi.fn(async (read: Record<string, unknown>) => {
      expect(read).toMatchObject({
        kind: "prepare_agent_move_pages",
        store_epoch: "store-native-agent",
        request: {
          page_ids: ["page-move-database", "page-move-library"],
          destination: {
            kind: "page",
            page_id: "page-move-target",
            at: { kind: "end" },
          },
        },
        authorization: {
          call_id: "call-native-agent",
          provenance: { profile_id: "profile-native-agent" },
        },
      });
      preparationCount += 1;
      return {
        store_epoch: "store-native-agent",
        event_sequence: 40,
        value: {
          kind: "agent_move_pages_preparation" as const,
          value: {
            preparation: {
              state: "prepared" as const,
              consent: "none" as const,
              token: `move-token-${preparationCount}`,
              expires_at_unix_ms: Date.now() + 30_000,
              footprint: {
                effect_class: "write" as const,
                targets: [],
                created_roots: [],
                updated_roots: ["page-move-database", "page-move-library"],
                deleted_roots: [],
                deleted_owner_roots: [],
                ownership_transformations: [],
              },
            },
            pages: [{
              page_id: "page-move-database",
              source: {
                kind: "data_source" as const,
                data_source_id: "data-source-move",
              },
              source_document_id: null,
              source_database_id: "database-move",
              source_project_id: "project-native-agent",
              target_project_id: "project-native-agent",
            }, {
              page_id: "page-move-library",
              source: {
                kind: "library" as const,
                library_id: "library-native-agent",
              },
              source_document_id: null,
              source_database_id: null,
              source_project_id: "project-native-agent",
              target_project_id: "project-native-agent",
            }],
            document_heads: [{
              document_id: "document-move-target",
              generation: 3,
              expected_head_seq: 8,
            }],
            destination: {
              kind: "page" as const,
              page_id: "page-move-target",
              expected_document_generation: 3,
              expected_document_head_seq: 8,
              before: null,
            },
            destination_document: {
              document_id: "document-move-target",
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
      expect(request.operationId).toMatch(/^nodex-agent-move-pages:/u);
      expect(request.intent.authorization.token).toBe("move-token-2");
      return {
        event_sequence: 43,
        receipt: { operation_id: request.operationId, duplicate: false },
        value: {
          agent_move_pages: {
            pages: [{
              page_id: "page-move-database",
              location: { kind: "page" as const, page_id: "page-move-target" },
            }, {
              page_id: "page-move-library",
              location: { kind: "page" as const, page_id: "page-move-target" },
            }],
            document_commits: [{
              document_id: "document-move-target",
              generation: 3,
              base_head_seq: 8,
              head_seq: 9,
              update_id: "move-target-1",
              update: [1],
              state_vector: [2],
            }, {
              document_id: "document-move-target",
              generation: 3,
              base_head_seq: 9,
              head_seq: 10,
              update_id: "move-target-2",
              update: [3],
              state_vector: [4],
            }],
            affected_database_ids: ["database-move"],
          },
        },
      };
    });
    const blockRecordRead = vi.fn(async (read: {
      readonly parent?: { readonly kind: string; readonly id?: string };
      readonly block_ids?: readonly string[];
    }) => {
      const target = read.parent?.kind === "block"
        || read.block_ids?.includes("page-copy-target") === true;
      return {
        library_id: "library-native-agent",
        observed_cursor: { store_epoch: "store-native-agent", commit_seq: 41 },
        graph: {
          library_id: "library-native-agent",
          blocks: target
            ? [{
                id: "page-move-target",
                library_id: "library-native-agent",
                kind: "page",
                lifecycle: "active",
                properties: { title: "Target" },
                content_shard_id: "shard:target",
                revision: 2,
              }]
            : [{
                id: "page-move-database",
                library_id: "library-native-agent",
                kind: "page",
                lifecycle: "active",
                properties: { title: "Database page" },
                content_shard_id: "shard:database",
                revision: 3,
              }, {
                id: "page-move-library",
                library_id: "library-native-agent",
                kind: "page",
                lifecycle: "active",
                properties: { title: "Library page" },
                content_shard_id: "shard:library",
                revision: 4,
              }],
          placements: target
            ? [{
                block_id: "page-move-target",
                parent: { kind: "library" },
                rank_key: "a",
                revision: 2,
              }]
            : [{
                block_id: "page-move-database",
                parent: { kind: "data_source", id: "data-source-move" },
                rank_key: "b",
                revision: 3,
              }, {
                block_id: "page-move-library",
                parent: { kind: "library" },
                rank_key: "c",
                revision: 4,
              }],
        },
        view_positions: [],
        content: [],
      };
    });
    const blockRecordApply = vi.fn(async (request: {
      readonly operation_id: string;
      readonly agent_authorization?: { readonly call_id: string };
    }) => {
      expect(request.agent_authorization).toMatchObject({ call_id: "call-native-agent" });
      return {
      actor_id: "profile-native-agent",
      audience: { kind: "library", projectIds: [] },
      canonical_hash: "a".repeat(64),
      commit_id: `commit:${request.operation_id}`,
      committed_at: "2026-08-06T00:00:00.000Z",
      cursor: { store_epoch: "store-native-agent", commit_seq: 42 },
      duplicate: false,
      effects: [],
      intent_hash: "b".repeat(64),
      operation_id: request.operation_id,
      payload_completeness: "rich" as const,
      session_id: "call-native-agent",
      };
    });
    const coordinate = vi.fn(async (options: {
      readonly execute: () => Promise<unknown>;
    }) => await options.execute());
    const runtime = {
      backend: "rust" as const,
      identity: nativeAgentIdentity,
      rootClient: {
        handshake: nativeAgentHandshake(),
      },
      clientForProject: () => ({ libraryRead, libraryApply, blockRecordRead, blockRecordApply }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve(runtime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync: {
        executeNodexAgentMutation: coordinate,
      } as unknown as Pick<DesktopDocumentSyncPort, "executeNodexAgentMutation">,
    });

    const result = await service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "move_pages",
    }, {
      pageIds: ["page-move-database", "page-move-library"],
      destination: {
        kind: "page",
        pageId: "page-move-target",
        at: { kind: "end" },
      },
    }, context);

    expect(result.output).toEqual({
      data: {
        pages: [{
          pageId: "page-move-database",
          location: { kind: "page", pageId: "page-move-target" },
        }, {
          pageId: "page-move-library",
          location: { kind: "page", pageId: "page-move-target" },
        }],
        moved: 2,
      },
    });
    expect(libraryRead).not.toHaveBeenCalled();
    expect(coordinate).toHaveBeenCalledOnce();
    expect(libraryApply).not.toHaveBeenCalled();
    expect(blockRecordApply).toHaveBeenCalledOnce();
  });

  test("duplicates a Page through the canonical ownership subtree", async () => {
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
    const blockRecordRead = vi.fn(async (read: {
      readonly parent?: { readonly kind: string; readonly id?: string };
      readonly block_ids?: readonly string[];
    }) => {
      const target = read.parent?.kind === "block"
        || read.block_ids?.includes("page-copy-target") === true;

      return {
        library_id: "library-native-agent",
        observed_cursor: { store_epoch: "store-native-agent", commit_seq: 20 },
        graph: {
          library_id: "library-native-agent",
          blocks: target
            ? [{
                id: "page-copy-target",
                library_id: "library-native-agent",
                kind: "page",
                lifecycle: "active",
                properties: { title: "Target" },
                content_shard_id: "shard:target",
                revision: 2,
              }, {
                id: "block-copy-anchor",
                library_id: "library-native-agent",
                kind: "paragraph",
                lifecycle: "active",
                properties: {},
                content_shard_id: "shard:anchor",
                revision: 3,
              }]
            : [{
                id: "page-copy-source",
                library_id: "library-native-agent",
                kind: "page",
                lifecycle: "active",
                properties: { title: "Source" },
                content_shard_id: "shard:source",
                revision: 4,
              }, {
                id: "block-copy-source",
                library_id: "library-native-agent",
                kind: "paragraph",
                lifecycle: "active",
                properties: {},
                content_shard_id: "shard:source-child",
                revision: 5,
              }, {
                id: "block-copy-child",
                library_id: "library-native-agent",
                kind: "paragraph",
                lifecycle: "active",
                properties: {},
                content_shard_id: "shard:source-child-2",
                revision: 6,
              }],
          placements: target
            ? [{
                block_id: "page-copy-target",
                parent: { kind: "library" },
                rank_key: "a",
                revision: 2,
              }, {
                block_id: "block-copy-anchor",
                parent: { kind: "block", id: "page-copy-target" },
                rank_key: "f",
                revision: 3,
              }]
            : [{
                block_id: "page-copy-source",
                parent: { kind: "library" },
                rank_key: "b",
                revision: 4,
              }, {
                block_id: "block-copy-source",
                parent: { kind: "block", id: "page-copy-source" },
                rank_key: "b",
                revision: 5,
              }, {
                block_id: "block-copy-child",
                parent: { kind: "block", id: "page-copy-source" },
                rank_key: "c",
                revision: 6,
              }],
        },
        view_positions: [],
        content: target ? [] : [{
          block_id: "page-copy-source",
          library_id: "library-native-agent",
          slot: "title",
          shard_id: "shard:source",
          revision: 1,
          materialized_json: [{ type: "text", text: "Source" }],
          full_state_v1: [],
          state_vector_v1: [],
          state_hash: "a".repeat(64),
        }],
      };
    });
    const blockRecordApply = vi.fn(async (request: {
      readonly operation_id: string;
      readonly agent_authorization?: { readonly call_id: string };
    }) => {
      expect(request.agent_authorization).toMatchObject({ call_id: "call-native-agent" });
      return {
      actor_id: "profile-native-agent",
      audience: { kind: "library", projectIds: [] },
      canonical_hash: "a".repeat(64),
      commit_id: `commit:${request.operation_id}`,
      committed_at: "2026-08-06T00:00:00.000Z",
      cursor: { store_epoch: "store-native-agent", commit_seq: 21 },
      duplicate: false,
      effects: [],
      intent_hash: "b".repeat(64),
      operation_id: request.operation_id,
      payload_completeness: "rich" as const,
      session_id: "call-native-agent",
      };
    });
    const coordinate = vi.fn(async (options: {
      readonly projectId: string;
      readonly storeEpoch: string;
      readonly execute: () => Promise<unknown>;
    }) => {
      expect(options.projectId).toBe("project-native-agent");
      expect(options.storeEpoch).toBe("store-native-agent");
      return await options.execute();
    });
    const runtime = {
      backend: "rust" as const,
      identity: nativeAgentIdentity,
      rootClient: {
        handshake: nativeAgentHandshake(),
      },
      clientForProject: () => ({ libraryRead, libraryApply, blockRecordRead, blockRecordApply }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve(runtime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync: {
        executeNodexAgentMutation: coordinate,
      } as unknown as Pick<DesktopDocumentSyncPort, "executeNodexAgentMutation">,
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
      return: ["block_map"],
    }, context);

    expect(result).toMatchObject({
      effect: "write",
      output: {
        data: {
          sourcePageId: "page-copy-source",
          pageId: expect.stringMatching(/^agent-page:/u),
          location: { kind: "page", pageId: "page-copy-target" },
          bodyBlocksCreated: 2,
          blockMap: {
            "page-copy-source": expect.stringMatching(/^agent-page:/u),
            "block-copy-source": expect.any(String),
            "block-copy-child": expect.any(String),
          },
        },
      },
    });
    expect(libraryRead).not.toHaveBeenCalled();
    expect(coordinate).toHaveBeenCalledOnce();
    expect(libraryApply).not.toHaveBeenCalled();
    expect(blockRecordApply).toHaveBeenCalledOnce();
  });

  test("searches native Library resources with Core authority and pagination", async () => {
    const base = pageWindow("page-native-search", [], 12);
    const blockRecordRead = vi.fn(async () => ({
      ...base,
      graph: {
        ...base.graph,
        blocks: base.graph.blocks.map((block) => block.id === "page-native-search"
          ? {
              ...block,
              properties: {
                title: "Native Search",
                dataSourceValues: [{ propertyId: "p_Abcd1234", value: "In progress" }],
              },
            }
          : block),
        placements: base.graph.placements.map((placement) => placement.block_id === "page-native-search"
          ? {
              ...placement,
              parent: { kind: "data_source" as const, id: "data-source-native-agent" },
            }
          : placement),
      },
    }));
    const runtime = {
      backend: "rust" as const,
      identity: nativeAgentIdentity,
      rootClient: {
        handshake: nativeAgentHandshake(),
      },
      clientForProject: () => ({ blockRecordRead }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve(runtime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync,
    });

    const result = await service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "search",
    }, {
      query: "nativ serch",
      scope: { kind: "data_source", dataSourceId: "data-source-native-agent" },
      page: { limit: 1 },
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
            source: "title",
            quality: "exact",
            excerpt: "Native Search",
          }, {
            source: "title",
            quality: "fuzzy",
            excerpt: "Native Search",
          }],
        }],
      },
      page: { hasMore: false },
    });
    expect(blockRecordRead).toHaveBeenCalledWith(expect.objectContaining({
      kind: "window",
      parent: { kind: "data_source", id: "data-source-native-agent" },
      include_content: true,
      include_descendants: true,
      include_archived: false,
    }), expect.objectContaining({ call_id: "call-native-agent" }));
  });

  test("fetches native stable Blocks with Core-minted guards and pagination", async () => {
    const baseCanonicalSnapshot = pageWindow("page-fetch", [
      { id: "block-fetch", type: "paragraph", text: "Fetched body" },
      { id: "block-fetch-2", type: "paragraph", text: "Second body" },
    ], 12);
    const canonicalSnapshot: BlockRecordReadSnapshot = {
      ...baseCanonicalSnapshot,
      graph: {
        ...baseCanonicalSnapshot.graph,
        placements: baseCanonicalSnapshot.graph.placements.map((placement, index) =>
          index === 0
            ? { ...placement, parent: { kind: "data_source" as const, id: "source-fetch" } }
            : placement
        ),
        blocks: baseCanonicalSnapshot.graph.blocks.map((block, index) =>
          index === 0
            ? {
                ...block,
                properties: {
                  title: "Fetch",
                  databaseId: "database-fetch",
                  dataSourceValues: [
                    { propertyId: "status", value: "todo" },
                    { propertyId: "p_Abcd1234", value: "high" },
                  ],
                },
              }
            : block
        ),
      },
      content: baseCanonicalSnapshot.content.map((content, index) =>
        index === 0
          ? {
              ...content,
              materialized_json: [{ type: "text", text: "Fetch", styles: {} }],
            }
          : content
      ),
    };
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
    const blockRecordRead = vi.fn(async (read: Record<string, unknown>) => {
      if (read.parent) {
        expect(read).toMatchObject({
          parent: { kind: "block", id: "page-fetch" },
          include_content: true,
          include_descendants: true,
        });
      } else {
        expect(read).toMatchObject({
          block_ids: ["page-fetch"],
          include_content: true,
          include_descendants: false,
        });
      }
      return canonicalSnapshot;
    });
    const runtime = {
      backend: "rust" as const,
      identity: nativeAgentIdentity,
      rootClient: {
        handshake: nativeAgentHandshake(),
      },
      clientForProject: () => ({ libraryRead, blockRecordRead }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve(runtime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync,
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
            etag: expect.stringMatching(/^nxe1\./u),
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
            etag: expect.stringMatching(/^nxe1\./u),
          }],
        },
        dataSource: {
          dataSourceId: "source-fetch",
          databaseId: "database-fetch",
        },
      },
      page: { hasMore: true, nextCursor: expect.stringMatching(/^nxc1\./u) },
    });
    expect(libraryRead).not.toHaveBeenCalled();
    expect(blockRecordRead).toHaveBeenCalledTimes(2);
  });

  test("queries native Data Sources with exact Agent authority and Core pagination", async () => {
    const database = {
      databaseId: "database-native-agent",
      libraryId: "library-native-agent",
      name: "Tasks",
      lifecycle: "active",
      defaultViewId: "view-native-agent",
      accessRevision: 1,
      metadataRevision: 1,
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    };
    const dataSource = {
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
    };
    const view = {
      viewId: "view-native-agent",
      databaseId: "database-native-agent",
      dataSourceId: "data-source-native-agent",
      name: "Tasks",
      kind: "list",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 2,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [],
        group: null,
        display: { propertyIds: [], showTitle: true },
      },
      isDefault: true,
      revision: 1,
      rankKey: "a",
      lifecycle: "active",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    };
    const databaseRead = vi.fn(async (read: { mode: string }) => {
      const value = (() => {
        switch (read.mode) {
          case "database":
            return {
              kind: "database" as const,
              value: { database },
            };
          case "data_source_window":
            return {
              kind: "data_source_window" as const,
              data_sources: {
                items: [dataSource],
                next_cursor: null,
                authority: { projection_revision: 13 },
              },
            };
          case "view_descriptor_window":
            return {
              kind: "view_descriptor_window" as const,
              views: {
                items: [view],
                next_cursor: null,
                authority: { projection_revision: 13 },
              },
            };
          case "data_source":
            return {
              kind: "data_source" as const,
              value: { dataSource },
            };
          case "property_window":
            return {
              kind: "property_window" as const,
              properties: {
                items: [],
                next_cursor: null,
                authority: { projection_revision: 13 },
              },
            };
          case "view":
            return { kind: "view" as const, value: view };
          default:
            return {
              kind: "agent_query" as const,
              value: {
                database_id: "database-native-agent",
                data_source_id: "data-source-native-agent",
                view_id: "view-native-agent",
                rows: {
                  items: [],
                  next_cursor: "nxl1.query.signature",
                  authority: { projection_revision: 13 },
                },
              },
            };
        }
      })();
      return {
        store_epoch: "store-native-agent",
        event_head: 13,
        value,
      };
    });
    const runtime = {
      backend: "rust" as const,
      identity: nativeAgentIdentity,
      rootClient: {
        handshake: nativeAgentHandshake(),
      },
      clientForProject: () => ({ databaseRead }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve(runtime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync,
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
    expect(databaseRead).toHaveBeenNthCalledWith(1, expect.objectContaining({
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
      mode: "agent_query",
    }));
  });

  test("commits exact Page patches through one canonical BlockRecord transaction", async () => {
    const before = pageWindow("page-update", [
      { id: "body-update-a", type: "paragraph", text: "Old" },
      { id: "body-update-b", type: "paragraph", text: "Old" },
    ], 7);
    const after = pageWindow("page-update", [
      { id: "body-update-a", type: "paragraph", text: "New" },
      { id: "body-update-b", type: "paragraph", text: "New" },
    ], 8);
    const blockRecordRead = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const blockRecordApply = vi.fn(async (input: BlockRecordApplyInput) =>
      committedBlockRecord(input.operation_id, 8));
    const runtime = {
      backend: "rust" as const,
      identity: nativeAgentIdentity,
      rootClient: {
        handshake: nativeAgentHandshake(),
      },
      clientForProject: () => ({ blockRecordRead, blockRecordApply }),
    } as unknown as DesktopDataAuthorityRuntime;
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve(runtime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      documentSync,
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
            created: 2,
            updated: 0,
            moved: 0,
            deleted: 2,
            blockIds: {
              created: [
                expect.stringMatching(/^agent-block-/u),
                expect.stringMatching(/^agent-block-/u),
              ],
              updated: [],
              deleted: ["body-update-a", "body-update-b"],
            },
          },
          body: { format: "markdown", markdown: "New\nNew" },
        },
      },
    });
    expect(blockRecordRead).toHaveBeenCalledTimes(3);
    expect(blockRecordApply).toHaveBeenCalledOnce();
    expect(blockRecordApply.mock.calls[0]?.[0].operation).toMatchObject({
      kind: "batch",
      operations: [{
        kind: "reconcile_page_tree",
        page_id: "page-update",
      }],
    });
  });

  test("maps Page insertion anchors into a canonical tree reconciliation", async () => {
    const blockRecordRead = vi.fn(async () => pageWindow("page-insert", [{
      id: "block-anchor",
      type: "paragraph",
      text: "Current",
    }], 4));
    const runtime = {
      backend: "rust" as const,
      identity: nativeAgentIdentity,
      rootClient: {
        handshake: nativeAgentHandshake(),
      },
      clientForProject: () => ({ blockRecordRead }),
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

    expect(blockRecordRead).toHaveBeenCalledWith(
      {
        kind: "window",
        parent: { kind: "block", id: "page-insert" },
        include_content: true,
        include_descendants: true,
      },
      expect.objectContaining({ call_id: "call-insert" }),
    );
    expect(prepared.result).toMatchObject({
      ok: true,
      value: {
        kind: "prepared",
        targetMarkdown: "Current\nInserted",
        effects: {
          createdBlockIds: [expect.stringMatching(/^agent-block-/u)],
        },
      },
    });
  });

  test("rejects a stale canonical Page ETag before creating a pending write", async () => {
    const blockRecordRead = vi.fn(async () => pageWindow("page-etag", [
      { id: "body-etag", type: "paragraph", text: "Current" },
    ], 11));
    const blockRecordApply = vi.fn();
    const runtime = {
      backend: "rust" as const,
      identity: nativeAgentIdentity,
      rootClient: {
        handshake: nativeAgentHandshake(),
      },
      clientForProject: () => ({ blockRecordRead, blockRecordApply }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const updates = new NativeNodexAgentPageUpdateRuntime(runtime);
    const input = UpdatePageV3InputSchema.parse({
      pageId: "page-etag",
      title: {
        markdown: "New title",
        ifMatch: "nxe1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    });

    const prepared = await updates.prepare({
      tool: "update_page",
      threadId: context.threadId,
      callId: "call-etag",
      projectId: context.authority.actorProjectId,
      authority: context.authority,
      input,
    });

    expect(prepared.result).toMatchObject({
      ok: false,
      error: {
        code: "conflict",
        recovery: "fetch_again",
        details: { domainCode: "canonical_etag_mismatch" },
      },
    });
    expect(blockRecordApply).not.toHaveBeenCalled();
  });

  test("maps guarded stable-Block batches into one canonical tree reconciliation", async () => {
    const blockRecordRead = vi.fn(async () => pageWindow("page-stable", [
      { id: "block-parent", type: "paragraph", text: "Parent" },
      { id: "block-anchor", type: "paragraph", text: "Anchor" },
      { id: "block-update", type: "paragraph", text: "Update" },
      { id: "block-move", type: "paragraph", text: "Move" },
      { id: "block-delete", type: "paragraph", text: "Delete" },
    ], 8));
    const blockRecordApply = vi.fn(async (request: BlockRecordApplyInput) =>
      committedBlockRecord(request.operation_id, 9));
    const runtime = {
      backend: "rust" as const,
      identity: nativeAgentIdentity,
      rootClient: {
        handshake: nativeAgentHandshake(),
      },
      clientForProject: () => ({ blockRecordRead, blockRecordApply }),
    } as unknown as Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>;
    const updates = new NativeNodexAgentPageUpdateRuntime(runtime);
    const blockContent = (text: string) => [{ type: "text" as const, text, styles: {} }];
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
        ifMatch: canonicalAgentBlockEtag("update", {
          id: "block-update",
          type: "paragraph",
          props: {},
          content: blockContent("Update"),
          children: [],
        }),
        patch: { props: { textAlignment: "center" } },
      }, {
        kind: "move",
        blockId: "block-move",
        at: { kind: "end", parentBlockId: "block-parent" },
      }, {
        kind: "delete",
        blockId: "block-delete",
        ifMatch: canonicalAgentBlockEtag("delete", {
          id: "block-delete",
          type: "paragraph",
          props: {},
          content: blockContent("Delete"),
          children: [],
        }),
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

    expect(prepared.result).toMatchObject({
      ok: true,
      value: {
        kind: "prepared",
        targetMarkdown: expect.any(String),
        effects: {
          createdBlockIds: [
            expect.stringMatching(/^agent-block-/u),
            expect.stringMatching(/^agent-block-/u),
          ],
          movedBlockIds: ["block-move", "block-anchor", "block-update"],
          deletedBlockIds: ["block-delete"],
          deletedOwnerBlockIds: [],
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
                "draft-root": expect.stringMatching(/^agent-block-/u),
                "draft-child": expect.stringMatching(/^agent-block-/u),
              },
            },
          },
        },
      },
    });
    expect(blockRecordApply).toHaveBeenCalledOnce();
    expect(blockRecordApply.mock.calls[0]?.[0].operation).toMatchObject({
      kind: "batch",
      operations: [{ kind: "reconcile_page_tree", page_id: "page-stable" }],
    });
  });
});
