import { NESTED_MARKDOWN_AGENT_GUIDE } from "../../shared/nfm/agent-guide";
import type {
  ExecuteNodexAgentCreatePagesResult,
  ExecuteNodexAgentDuplicatePageResult,
  ExecuteNodexAgentMovePagesResult,
  NodexAgentV3ReadCommandResult,
  NodexAgentV3ReadRequest,
  PrepareNodexAgentCreatePagesResult,
  PrepareNodexAgentMovePagesResult,
  ToolFailure,
} from "../../shared/nodex-agent-tools";
import { GetContextV3OutputSchema } from "../../shared/nodex-agent-tools/v3-read-schemas";
import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../../shared/database-module-v2";
import type { BlockMutationEnvelope } from "../block-mutation-writer";
import {
  NodexAgentV3DynamicService,
  type NodexAgentV3DocumentHub,
  type NodexAgentV3Writer,
} from "../agent-tools/dynamic-service-v3";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import type { DesktopDatabaseModuleBridge } from "./desktop-database-module-bridge";
import type { DesktopDocumentSyncPort } from "./desktop-document-sync-bridge";
import type { DesktopProjectWorkspacePort } from "./project-workspace-adapter";
import { readNativeFetch } from "./native-nodex-agent-fetch";
import { readNativeDatabaseQuery } from "./native-nodex-agent-query";
import { readNativeSearch } from "./native-nodex-agent-search";
import { NativeNodexAgentPageCopyRuntime } from "./native-nodex-agent-page-copy";
import { NativeNodexAgentPageUpdateRuntime } from "./native-nodex-agent-page-update";

type ToolError = ToolFailure["error"];

export interface DesktopNodexAgentDynamicServiceInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly projectWorkspace: DesktopProjectWorkspacePort;
  readonly databaseModule: DesktopDatabaseModuleBridge;
  readonly documentSync: Pick<
    DesktopDocumentSyncPort,
    "coordinateNodexAgentLeasedMutation"
  >;
  readonly typescript: {
    readonly writer: NodexAgentV3Writer;
    readonly documentHub: NodexAgentV3DocumentHub;
  };
}

const nativeUnavailableError = (tool: string): ToolError => ({
  code: "internal_error",
  message: `Nodex Agent tool ${tool} is not yet available through native Core`,
  retryable: false,
  recovery: "none",
  details: { domainCode: "native_agent_tool_unavailable" },
});

const nativeDuplicatePageFailure = (
  message: string,
  recovery: "get_block_again" | "none" = "none",
): ExecuteNodexAgentDuplicatePageResult => ({
  ok: false,
  error: {
    code: recovery === "get_block_again" ? "conflict" : "internal_error",
    message,
    retryable: false,
    recovery,
  },
});

const envelope = <Result>(
  result: Result,
  mutationId: string,
): BlockMutationEnvelope<Result> => ({
  result,
  events: [],
  metrics: {
    mutationId,
    queueWaitMs: 0,
    workerDurationMs: 0,
    transactionMs: 0,
    eventCount: 0,
  },
});

async function readNativeContext(
  request: Extract<NodexAgentV3ReadRequest, { readonly tool: "get_context" }>,
  projectWorkspace: DesktopProjectWorkspacePort,
  databaseModule: DesktopDatabaseModuleBridge,
): Promise<NodexAgentV3ReadCommandResult> {
  if (!request.projectId) {
    return {
      ok: true,
      tool: request.tool,
      output: GetContextV3OutputSchema.parse({
        data: {
          project: null,
          access: {
            read: request.access.read,
            write: request.access.write,
            domains: request.access.read === "allowed" ? ["page", "database"] : [],
          },
          ...(request.input.include?.markdownGuide
            ? { markdownGuide: NESTED_MARKDOWN_AGENT_GUIDE }
            : {}),
        },
      }),
    };
  }

  const project = await projectWorkspace.getProject(request.projectId);
  if (!project) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: `Project ${request.projectId} was not found`,
        retryable: false,
        recovery: "start_new_task",
      },
    };
  }

  const catalog = request.input.include?.databases
    ? await databaseModule.read({
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: request.projectId,
        read: { target: { kind: "project_default" }, mode: "catalog" },
      })
    : null;
  if (catalog && !catalog.ok) {
    return {
      ok: false,
      error: {
        code: catalog.error.code === "authorization_denied"
          ? "authorization_denied"
          : catalog.error.code === "resource_not_found"
            ? "not_found"
            : "internal_error",
        message: catalog.error.message,
        retryable: catalog.error.retryable,
        recovery: "none",
        details: { domainCode: catalog.error.code },
      },
    };
  }
  if (catalog?.ok && catalog.value.value.kind !== "catalog") {
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "Database Core returned an incompatible Agent context snapshot",
        retryable: false,
        recovery: "none",
        details: { domainCode: "database_catalog_variant_mismatch" },
      },
    };
  }

  const databaseCatalog = catalog?.ok && catalog.value.value.kind === "catalog"
    ? catalog.value.value
    : null;
  const databases = databaseCatalog
    ? databaseCatalog.databases.map((descriptor) => ({
        databaseId: descriptor.database.databaseId,
        name: descriptor.database.name,
        isBound: descriptor.database.databaseId === project.databaseId,
        dataSources: descriptor.dataSources
          .filter((source) => source.lifecycle === "active")
          .map((source) => ({
            dataSourceId: source.dataSourceId,
            name: source.name,
            schemaRevision: source.schemaRevision,
          })),
        views: descriptor.views
          .filter((view) => view.lifecycle === "active")
          .map((view) => ({
            viewId: view.viewId,
            dataSourceId: view.dataSourceId,
            name: view.name,
            kind: view.kind,
            isDefault: view.isDefault,
          })),
      }))
    : undefined;

  return {
    ok: true,
    tool: request.tool,
    output: GetContextV3OutputSchema.parse({
      data: {
        project: {
          projectId: project.id,
          name: project.name,
          lifecycle: project.lifecycle,
          libraryId: project.libraryId,
          boundDatabaseId: project.databaseId,
        },
        access: {
          read: request.access.read,
          write: project.lifecycle === "active"
            ? request.access.write
            : "unavailable",
          domains: request.access.read === "allowed" ? ["page", "database"] : [],
        },
        ...(databases ? { databases } : {}),
        ...(request.input.include?.markdownGuide
          ? { markdownGuide: NESTED_MARKDOWN_AGENT_GUIDE }
          : {}),
      },
    }),
  };
}

export function createDesktopNodexAgentV3DynamicService(
  input: DesktopNodexAgentDynamicServiceInput,
): NodexAgentV3DynamicService {
  let nativePageUpdates: NativeNodexAgentPageUpdateRuntime | null = null;
  let nativePageCopies: NativeNodexAgentPageCopyRuntime | null = null;
  const pageUpdatesFor = (
    runtime: Extract<DesktopDataAuthorityRuntime, { readonly backend: "rust" }>,
  ): NativeNodexAgentPageUpdateRuntime => {
    nativePageUpdates ??= new NativeNodexAgentPageUpdateRuntime(runtime);
    return nativePageUpdates;
  };
  const pageCopiesFor = (
    runtime: Extract<DesktopDataAuthorityRuntime, { readonly backend: "rust" }>,
  ): NativeNodexAgentPageCopyRuntime => {
    nativePageCopies ??= new NativeNodexAgentPageCopyRuntime(runtime);
    return nativePageCopies;
  };
  const writer: NodexAgentV3Writer = {
    readNodexAgentV3Tool: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.writer.readNodexAgentV3Tool(request);
      }
      const result = request.tool === "get_context"
        ? await readNativeContext(
            request,
            input.projectWorkspace,
            input.databaseModule,
          )
        : request.tool === "fetch"
          ? await readNativeFetch(request, runtime)
        : request.tool === "search"
          ? await readNativeSearch(request, runtime)
          : await readNativeDatabaseQuery(request, runtime);
      return envelope(result, request.callId ?? `nodex-agent:${request.tool}`);
    },
    prepareNodexAgentPageUpdate: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.writer.prepareNodexAgentPageUpdate(request);
      }
      return await pageUpdatesFor(runtime).prepare(request);
    },
    completeNodexAgentPageUpdate: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.writer.completeNodexAgentPageUpdate(request);
      }
      return await pageUpdatesFor(runtime).complete(request);
    },
    prepareNodexAgentCreatePages: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.writer.prepareNodexAgentCreatePages(request);
      }
      const result: PrepareNodexAgentCreatePagesResult = {
        ok: false,
        error: nativeUnavailableError("create_pages"),
      };
      return envelope(result, request.callId);
    },
    prepareNodexAgentDuplicatePage: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.writer.prepareNodexAgentDuplicatePage(request);
      }
      return await pageCopiesFor(runtime).prepare(request);
    },
    prepareNodexAgentMovePages: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.writer.prepareNodexAgentMovePages(request);
      }
      const result: PrepareNodexAgentMovePagesResult = {
        ok: false,
        error: nativeUnavailableError("move_pages"),
      };
      return envelope(result, request.callId);
    },
  };

  const documentHub: NodexAgentV3DocumentHub = {
    applyDocumentMutation: async (...args) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.documentHub.applyDocumentMutation(...args);
      }
      return await pageUpdatesFor(runtime).apply(args[0]);
    },
    executeNodexAgentCreatePages: async (...args) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.documentHub.executeNodexAgentCreatePages(...args);
      }
      const result: ExecuteNodexAgentCreatePagesResult = {
        ok: false,
        error: nativeUnavailableError("create_pages"),
      };
      return result;
    },
    executeNodexAgentDuplicatePage: async (...args) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.documentHub.executeNodexAgentDuplicatePage(...args);
      }
      const command = args[0];
      return await input.documentSync.coordinateNodexAgentLeasedMutation({
        projectId: command.projectId,
        storeEpoch: command.storeEpoch,
        leaseDocuments: command.leaseDocuments,
        execute: async () => await pageCopiesFor(runtime).execute(command),
        failure: nativeDuplicatePageFailure,
        operationLabel: "Agent Page duplicate",
        conflictMessage: "A copied Page Document changed while preparing duplication",
      });
    },
    executeNodexAgentMovePages: async (...args) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.documentHub.executeNodexAgentMovePages(...args);
      }
      const result: ExecuteNodexAgentMovePagesResult = {
        ok: false,
        error: nativeUnavailableError("move_pages"),
      };
      return result;
    },
  };

  return new NodexAgentV3DynamicService({ writer, documentHub });
}
