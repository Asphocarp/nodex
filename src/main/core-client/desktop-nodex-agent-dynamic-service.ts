import { NESTED_MARKDOWN_AGENT_GUIDE } from "../../shared/nfm/agent-guide";
import type {
  ExecuteNodexAgentCreatePagesResult,
  ExecuteNodexAgentDuplicatePageResult,
  ExecuteNodexAgentMovePagesResult,
  NodexAgentV3ReadCommandResult,
  NodexAgentV3ReadRequest,
} from "../../shared/nodex-agent-tools";
import { GetContextV3OutputSchema } from "../../shared/nodex-agent-tools/v3-read-schemas";
import {
  NodexAgentV3DynamicService,
  type NodexAgentV3DocumentHub,
  type NodexAgentV3Writer,
} from "../agent-tools/dynamic-service-v3";
import type { NodexAgentMutationEnvelope } from "../agent-tools/dynamic-service-v3-port";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import type { DesktopDatabaseModuleBridge } from "./desktop-database-module-bridge";
import type { DesktopDocumentSyncPort } from "./desktop-document-sync-bridge";
import type { DesktopProjectWorkspacePort } from "./project-workspace-adapter";
import { readNativeFetch } from "./native-nodex-agent-fetch";
import { readNativeDatabaseQuery } from "./native-nodex-agent-query";
import { readNativeSearch } from "./native-nodex-agent-search";
import { NativeNodexAgentPageCopyRuntime } from "./native-nodex-agent-page-copy";
import { NativeNodexAgentPageCreateRuntime } from "./native-nodex-agent-page-create";
import { NativeNodexAgentPageMoveRuntime } from "./native-nodex-agent-page-move";
import { NativeNodexAgentPageUpdateRuntime } from "./native-nodex-agent-page-update";

export interface DesktopNodexAgentDynamicServiceInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly projectWorkspace: DesktopProjectWorkspacePort;
  readonly databaseModule: DesktopDatabaseModuleBridge;
  readonly documentSync: Pick<
    DesktopDocumentSyncPort,
    "executeNodexAgentMutation"
  >;
}

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

const nativeCreatePagesFailure = (
  message: string,
  recovery: "get_block_again" | "none" = "none",
): ExecuteNodexAgentCreatePagesResult => ({
  ok: false,
  error: {
    code: recovery === "get_block_again" ? "conflict" : "internal_error",
    message,
    retryable: false,
    recovery,
  },
});

const nativeMovePagesFailure = (
  message: string,
  recovery: "get_block_again" | "none" = "none",
): ExecuteNodexAgentMovePagesResult => ({
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
): NodexAgentMutationEnvelope<Result> => ({
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

  const database = request.input.include?.databases
    ? await databaseModule.read({
        projectId: request.projectId,
        read: { target: { kind: "project_default" }, mode: "database" },
      })
    : null;
  if (database && !database.ok) {
    return {
      ok: false,
      error: {
        code: database.error.code === "authorization_denied"
          ? "authorization_denied"
          : database.error.code === "resource_not_found"
            ? "not_found"
            : "internal_error",
        message: database.error.message,
        retryable: database.error.retryable,
        recovery: "none",
        details: { domainCode: database.error.code },
      },
    };
  }
  if (database?.ok && database.value.value.kind !== "database") {
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "Database Core returned an incompatible Agent context snapshot",
        retryable: false,
        recovery: "none",
        details: { domainCode: "database_descriptor_variant_mismatch" },
      },
    };
  }

  const databaseDescriptor =
    database?.ok && database.value.value.kind === "database"
      ? database.value.value.value
      : null;
  const databases = databaseDescriptor
    ? [{
        databaseId: databaseDescriptor.database.databaseId,
        name: databaseDescriptor.database.name,
        isBound: databaseDescriptor.database.databaseId === project.databaseId,
        dataSources: databaseDescriptor.dataSources
          .filter((source) => source.lifecycle === "active")
          .map((source) => ({
            dataSourceId: source.dataSourceId,
            name: source.name,
            schemaRevision: source.schemaRevision,
          })),
        views: databaseDescriptor.views
          .filter((view) => view.lifecycle === "active")
          .map((view) => ({
            viewId: view.viewId,
            dataSourceId: view.dataSourceId,
            name: view.name,
            defaultLayout: view.defaultLayout,
            isDefault: view.isDefault,
          })),
      }]
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
  let nativePageCreates: NativeNodexAgentPageCreateRuntime | null = null;
  let nativePageMoves: NativeNodexAgentPageMoveRuntime | null = null;
  const pageUpdatesFor = (
    runtime: DesktopDataAuthorityRuntime,
  ): NativeNodexAgentPageUpdateRuntime => {
    nativePageUpdates ??= new NativeNodexAgentPageUpdateRuntime(runtime);
    return nativePageUpdates;
  };
  const pageCopiesFor = (
    runtime: DesktopDataAuthorityRuntime,
  ): NativeNodexAgentPageCopyRuntime => {
    nativePageCopies ??= new NativeNodexAgentPageCopyRuntime(runtime);
    return nativePageCopies;
  };
  const pageCreatesFor = (
    runtime: DesktopDataAuthorityRuntime,
  ): NativeNodexAgentPageCreateRuntime => {
    nativePageCreates ??= new NativeNodexAgentPageCreateRuntime(runtime);
    return nativePageCreates;
  };
  const pageMovesFor = (
    runtime: DesktopDataAuthorityRuntime,
  ): NativeNodexAgentPageMoveRuntime => {
    nativePageMoves ??= new NativeNodexAgentPageMoveRuntime(runtime);
    return nativePageMoves;
  };
  const writer: NodexAgentV3Writer = {
    readNodexAgentV3Tool: async (request) => {
      const runtime = await input.authority;
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
      return await pageUpdatesFor(runtime).prepare(request);
    },
    completeNodexAgentPageUpdate: async (request) => {
      const runtime = await input.authority;
      return await pageUpdatesFor(runtime).complete(request);
    },
    prepareNodexAgentCreatePages: async (request) => {
      const runtime = await input.authority;
      return await pageCreatesFor(runtime).prepare(request);
    },
    prepareNodexAgentDuplicatePage: async (request) => {
      const runtime = await input.authority;
      return await pageCopiesFor(runtime).prepare(request);
    },
    prepareNodexAgentMovePages: async (request) => {
      const runtime = await input.authority;
      return await pageMovesFor(runtime).prepare(request);
    },
  };

  const documentHub: NodexAgentV3DocumentHub = {
    applyDocumentMutation: async (...args) => {
      const runtime = await input.authority;
      return await pageUpdatesFor(runtime).apply(args[0]);
    },
    executeNodexAgentCreatePages: async (...args) => {
      const runtime = await input.authority;
      const [command, documentHeads] = args;
      return await input.documentSync.executeNodexAgentMutation({
        projectId: command.projectId,
        storeEpoch: command.storeEpoch,
        execute: async () => await pageCreatesFor(runtime).execute(
          command,
          documentHeads,
        ),
        failure: nativeCreatePagesFailure,
        operationLabel: "Agent Page creation",
        conflictMessage: "A target Page Document changed while preparing Page creation",
      });
    },
    executeNodexAgentDuplicatePage: async (...args) => {
      const runtime = await input.authority;
      const command = args[0];
      return await input.documentSync.executeNodexAgentMutation({
        projectId: command.projectId,
        storeEpoch: command.storeEpoch,
        execute: async () => await pageCopiesFor(runtime).execute(command),
        failure: nativeDuplicatePageFailure,
        operationLabel: "Agent Page duplicate",
        conflictMessage: "A copied Page Document changed while preparing duplication",
      });
    },
    executeNodexAgentMovePages: async (...args) => {
      const runtime = await input.authority;
      const command = args[0];
      return await input.documentSync.executeNodexAgentMutation({
        projectId: command.projectId,
        storeEpoch: command.storeEpoch,
        execute: async () => await pageMovesFor(runtime).execute(command),
        failure: nativeMovePagesFailure,
        operationLabel: "Agent Page movement",
        conflictMessage: "A Page Document changed while preparing Page movement",
      });
    },
  };

  return new NodexAgentV3DynamicService({ writer, documentHub });
}
