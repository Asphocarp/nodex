import { describe, expect, test, vi } from "vitest";
import {
  NODEX_APP_TOOL_NAMESPACE,
  NODEX_APP_V5_TOOLSET_REVISION,
} from "../../shared/nodex-agent-tools";
import type { NodexAgentDynamicExecutionContext } from "../agent-tools/dynamic-service-core";
import type {
  NodexAgentV3DocumentHub,
  NodexAgentV3Writer,
} from "../agent-tools/dynamic-service-v3";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import type { DesktopDatabaseModuleBridge } from "./desktop-database-module-bridge";
import { createDesktopNodexAgentV3DynamicService } from "./desktop-nodex-agent-dynamic-service";
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

  test("fails closed for an unported native tool instead of invoking TypeScript", async () => {
    const service = createDesktopNodexAgentV3DynamicService({
      authority: Promise.resolve({ backend: "rust" } as DesktopDataAuthorityRuntime),
      projectWorkspace: {} as DesktopProjectWorkspacePort,
      databaseModule: {} as DesktopDatabaseModuleBridge,
      typescript,
    });

    await expect(service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "search",
    }, { query: "native" }, context)).rejects.toMatchObject({
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
});
