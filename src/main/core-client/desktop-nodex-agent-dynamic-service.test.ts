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

describe("desktop Nodex Agent dynamic service", () => {
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
});
