import type {
  AgentDocumentEditEffects,
  NodexAgentAuthorizationPreview,
  NodexAgentPageUpdateOutput,
  NodexAgentCreatePagesCommand,
  NodexAgentDuplicatePageCommand,
  NodexAgentMovePagesCommand,
  NodexAgentTransferAuthorizationEvidence,
  ToolFailure,
} from "../../shared/nodex-agent-tools";
import { blockMutationWriter } from "../block-mutation-writer";
import {
  createNodexV3DynamicToolRegistry,
  type NodexAgentV3ToolHandlers,
  type NodexAgentV3ToolInput,
} from "../codex/nodex-dynamic-tool-registry";
import { documentSyncHub } from "../document-sync-runtime";
import {
  authorizationFootprint,
  type NodexAgentAuthorizationFootprint,
} from "./authorization-footprint";
import {
  fail,
  prepareAuthorizedWrite,
  projectRequired,
  toolFailure,
  withExecutionTimeout,
  type NodexAgentDynamicExecutionContext,
} from "./dynamic-service-core";

const NODEX_AGENT_EXECUTION_TIMEOUT_MS = 30_000;
const MAX_AUTHORIZATION_MARKDOWN_PREVIEW_CHARS = 1_600;

type PageDestination =
  | { readonly kind: "library" }
  | { readonly kind: "page"; readonly pageId: string }
  | { readonly kind: "data_source"; readonly dataSourceId: string };

type PageUpdateInput =
  | NodexAgentV3ToolInput<"update_page">
  | NodexAgentV3ToolInput<"advanced_update_page">;

export type NodexAgentV3Writer = Pick<
  typeof blockMutationWriter,
  | "readNodexAgentV3Tool"
  | "prepareNodexAgentPageUpdate"
  | "completeNodexAgentPageUpdate"
  | "prepareNodexAgentCreatePages"
  | "prepareNodexAgentDuplicatePage"
  | "prepareNodexAgentMovePages"
>;

export type NodexAgentV3DocumentHub = Pick<
  typeof documentSyncHub,
  | "applyDocumentMutation"
  | "executeNodexAgentCreatePages"
  | "executeNodexAgentDuplicatePage"
  | "executeNodexAgentMovePages"
>;

export interface NodexAgentV3DynamicServiceOptions {
  readonly writer?: NodexAgentV3Writer;
  readonly documentHub?: NodexAgentV3DocumentHub;
  readonly executionTimeoutMs?: number;
}

function destinationLabel(destination: PageDestination): string {
  if (destination.kind === "library") return "Library";
  if (destination.kind === "page") return `Page ${destination.pageId}`;
  return `Data Source ${destination.dataSourceId}`;
}

function destinationResource(destination: PageDestination): string {
  if (destination.kind === "library") return "library";
  if (destination.kind === "page") return `page:${destination.pageId}`;
  return `data_source:${destination.dataSourceId}`;
}

function boundedMarkdownPreview(markdown: string): string | undefined {
  const normalized = markdown.trim();
  if (!normalized) return undefined;
  if (normalized.length <= MAX_AUTHORIZATION_MARKDOWN_PREVIEW_CHARS) return normalized;
  return `${normalized.slice(0, MAX_AUTHORIZATION_MARKDOWN_PREVIEW_CHARS)}\n…`;
}

function createPagesPreview(
  input: NodexAgentV3ToolInput<"create_pages">,
  pages: readonly {
    readonly title: string;
    readonly bodyBlockCount: number;
    readonly targetMarkdown: string;
  }[],
): NodexAgentAuthorizationPreview {
  const blocks = pages.reduce((total, page) => total + page.bodyBlockCount, 0);
  const preview = boundedMarkdownPreview(pages.map((page) => [
    `# ${page.title}`,
    page.targetMarkdown,
  ].filter(Boolean).join("\n\n")).join("\n\n---\n\n"));
  return {
    title: `Create ${pages.length} Page${pages.length === 1 ? "" : "s"}`,
    summary: `Create ${pages.length} complete Page${pages.length === 1 ? "" : "s"} with ${blocks} body Block${blocks === 1 ? "" : "s"}.`,
    details: [
      { label: "Destination", value: destinationLabel(input.destination) },
      { label: "Pages", value: pages.map((page) => page.title).join(", ") },
    ],
    ...(preview ? { markdownPreview: preview } : {}),
  };
}

function pageUpdatePreview(
  tool: "update_page" | "advanced_update_page",
  input: PageUpdateInput,
  effects: AgentDocumentEditEffects,
  targetMarkdown: string,
): NodexAgentAuthorizationPreview {
  const counts = [
    effects.createdBlockIds.length > 0 ? `${effects.createdBlockIds.length} create` : null,
    effects.updatedBlockIds.length > 0 ? `${effects.updatedBlockIds.length} update` : null,
    effects.movedBlockIds.length > 0 ? `${effects.movedBlockIds.length} move` : null,
    effects.deletedBlockIds.length > 0 ? `${effects.deletedBlockIds.length} delete` : null,
    tool === "update_page" && "title" in input && input.title ? "title update" : null,
  ].filter((entry): entry is string => entry !== null);
  const preview = boundedMarkdownPreview(targetMarkdown);
  return {
    title: tool === "update_page" ? "Update Page" : "Advanced Page update",
    summary: counts.length > 0 ? counts.join(", ") : "Update Page content.",
    details: [
      { label: "Page", value: input.pageId },
      ...(tool === "update_page" && "body" in input && input.body
        ? [{ label: "Method", value: input.body.kind }]
        : []),
    ],
    ...(preview ? { markdownPreview: preview } : {}),
  };
}

function movePagesPreview(
  input: NodexAgentV3ToolInput<"move_pages">,
  authorization: NodexAgentTransferAuthorizationEvidence,
): NodexAgentAuthorizationPreview {
  return {
    title: `Move ${input.pageIds.length} Page${input.pageIds.length === 1 ? "" : "s"}`,
    summary: "Move the selected Pages and their complete owned content atomically.",
    details: [
      { label: "Destination", value: destinationLabel(input.destination) },
      { label: "Pages", value: input.pageIds.join(", ") },
      ...(authorization.documentIds.length > 0
        ? [{
            label: "Document scope",
            value: `${authorization.documentIds.length} Document${authorization.documentIds.length === 1 ? "" : "s"}`,
          }]
        : []),
    ],
  };
}

function duplicatePagePreview(
  input: NodexAgentV3ToolInput<"duplicate_page">,
  authorization: NodexAgentTransferAuthorizationEvidence,
): NodexAgentAuthorizationPreview {
  return {
    title: "Duplicate Page",
    summary: "Copy the complete Page ownership subtree with fresh identities.",
    details: [
      { label: "Source Page", value: input.pageId },
      { label: "Destination", value: destinationLabel(input.destination) },
      ...(authorization.documentIds.length > 0
        ? [{
            label: "Document scope",
            value: `${authorization.documentIds.length} Document${authorization.documentIds.length === 1 ? "" : "s"}`,
          }]
        : []),
    ],
  };
}

function createPagesFootprint(
  projectId: string,
  command: NodexAgentCreatePagesCommand,
): NodexAgentAuthorizationFootprint {
  return authorizationFootprint({
    tool: "create_pages",
    projectId,
    effect: "write",
    resources: [
      destinationResource(command.input.destination),
      ...command.pages.map((page) => `page:${page.pageId}`),
    ],
    deletions: [],
    transformations: command.pages.map((page) =>
      `page.create:${page.pageId}:body-blocks:${page.bodyBlockIds.length}`
    ),
  });
}

function pageUpdateFootprint(
  projectId: string,
  tool: "update_page" | "advanced_update_page",
  input: PageUpdateInput,
  effects: AgentDocumentEditEffects,
): NodexAgentAuthorizationFootprint {
  const destructive = effects.deletedBlockIds.length > 0
    || (tool === "update_page"
      && "body" in input
      && input.body?.kind === "replace");
  return authorizationFootprint({
    tool,
    projectId,
    effect: destructive ? "destructive" : "write",
    resources: [
      `page:${input.pageId}`,
      ...effects.createdBlockIds.map((id) => `block:${id}`),
      ...effects.updatedBlockIds.map((id) => `block:${id}`),
      ...effects.movedBlockIds.map((id) => `block:${id}`),
      ...effects.deletedBlockIds.map((id) => `block:${id}`),
    ],
    deletions: [
      ...effects.deletedBlockIds.map((id) => `block:${id}`),
      ...effects.deletedOwnerBlockIds.map((id) => `owner:${id}`),
    ],
    transformations: tool === "update_page"
      ? [
          ...("title" in input && input.title ? ["title.set"] : []),
          ...("body" in input && input.body ? [`body.${input.body.kind}`] : []),
        ]
      : ["stable-block-edits"],
  });
}

function movePagesFootprint(
  projectId: string,
  command: NodexAgentMovePagesCommand,
): NodexAgentAuthorizationFootprint {
  return authorizationFootprint({
    tool: "move_pages",
    projectId,
    effect: "write",
    resources: [
      destinationResource(command.input.destination),
      ...command.input.pageIds.map((pageId) => `page:${pageId}`),
      ...command.leaseDocuments.map((lease) => `document:${lease.documentId}`),
    ],
    deletions: [],
    transformations: command.input.pageIds.map((pageId) =>
      `page.move:${pageId}->${command.input.destination.kind}`
    ),
  });
}

function duplicatePageFootprint(
  projectId: string,
  command: NodexAgentDuplicatePageCommand,
): NodexAgentAuthorizationFootprint {
  return authorizationFootprint({
    tool: "duplicate_page",
    projectId,
    effect: "write",
    resources: [
      `page:${command.input.pageId}`,
      destinationResource(command.input.destination),
      ...command.leaseDocuments.map((lease) => `document:${lease.documentId}`),
    ],
    deletions: [],
    transformations: [`page.duplicate:${command.input.pageId}->${command.input.destination.kind}`],
  });
}

function mapDocumentMutationFailure(
  error: { readonly code: string; readonly message: string; readonly retryable: boolean },
): ToolFailure {
  const conflict = error.code.includes("conflict");
  return toolFailure(
    conflict ? "conflict" : "internal_error",
    error.message,
    conflict ? "fetch_again" : "retry_same",
    error.retryable,
  );
}

export class NodexAgentV3DynamicService {
  private readonly writer: NodexAgentV3Writer;
  private readonly documentHub: NodexAgentV3DocumentHub;
  private readonly executionTimeoutMs: number;
  readonly registry;

  constructor(options: NodexAgentV3DynamicServiceOptions = {}) {
    this.writer = options.writer ?? blockMutationWriter;
    this.documentHub = options.documentHub ?? documentSyncHub;
    this.executionTimeoutMs = options.executionTimeoutMs
      ?? NODEX_AGENT_EXECUTION_TIMEOUT_MS;
    const handlers: NodexAgentV3ToolHandlers<NodexAgentDynamicExecutionContext> = {
      get_context: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentV3Tool({
          tool: "get_context",
          projectId: context.projectId,
          access: context.access,
          input,
        })).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "get_context") throw new Error("Nodex v3 read tool mismatch");
        return result.output;
      },
      search: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentV3Tool({
          tool: "search",
          projectId: projectRequired(context),
          input,
        })).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "search") throw new Error("Nodex v3 read tool mismatch");
        return result.output;
      },
      fetch: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentV3Tool({
          tool: "fetch",
          projectId: projectRequired(context),
          input,
        })).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "fetch") throw new Error("Nodex v3 read tool mismatch");
        return result.output;
      },
      query_database_view: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentV3Tool({
          tool: "query_database_view",
          projectId: projectRequired(context),
          input,
        })).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "query_database_view") {
          throw new Error("Nodex v3 read tool mismatch");
        }
        return result.output;
      },
      query_data_source: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentV3Tool({
          tool: "query_data_source",
          projectId: projectRequired(context),
          input,
        })).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "query_data_source") {
          throw new Error("Nodex v3 read tool mismatch");
        }
        return result.output;
      },
      create_pages: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const request = {
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        };
        const prepared = await prepareAuthorizedWrite(context, {
          prepare: async () => {
            const result = (await this.writer.prepareNodexAgentCreatePages(request)).result;
            if (!result.ok) return fail({ error: result.error });
            return result.value;
          },
          footprint: (value) => createPagesFootprint(projectId, value.command),
          authorization: (value) => ({
            tool: "create_pages",
            preview: createPagesPreview(input, value.previews),
          }),
        });
        if (prepared.kind === "completed") return prepared.output;
        const result = await withExecutionTimeout(
          async () => await this.documentHub.executeNodexAgentCreatePages(
            prepared.command,
            prepared.leaseDocuments,
          ),
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ error: result.error });
        return result.value.output;
      },
      update_page: async ({ input, context }) =>
        await this.executePageUpdate("update_page", input, context),
      advanced_update_page: async ({ input, context }) =>
        await this.executePageUpdate("advanced_update_page", input, context),
      move_pages: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const request = {
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        };
        const prepared = await prepareAuthorizedWrite(context, {
          prepare: async () => {
            const result = (await this.writer.prepareNodexAgentMovePages(request)).result;
            if (!result.ok) return fail({ error: result.error });
            return result.value;
          },
          footprint: (value) => movePagesFootprint(projectId, value.command),
          authorization: (value) => ({
            tool: "move_pages",
            preview: movePagesPreview(input, value.authorization),
          }),
        });
        if (prepared.kind === "completed") return prepared.output;
        const result = await withExecutionTimeout(
          async () => await this.documentHub.executeNodexAgentMovePages(prepared.command),
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ error: result.error });
        return result.value.output;
      },
      duplicate_page: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const request = {
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        };
        const prepared = await prepareAuthorizedWrite(context, {
          prepare: async () => {
            const result = (await this.writer.prepareNodexAgentDuplicatePage(request)).result;
            if (!result.ok) return fail({ error: result.error });
            return result.value;
          },
          footprint: (value) => duplicatePageFootprint(projectId, value.command),
          authorization: (value) => ({
            tool: "duplicate_page",
            preview: duplicatePagePreview(input, value.authorization),
          }),
        });
        if (prepared.kind === "completed") return prepared.output;
        const result = await withExecutionTimeout(
          async () => await this.documentHub.executeNodexAgentDuplicatePage(prepared.command),
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ error: result.error });
        return result.value.output;
      },
    };
    this.registry = createNodexV3DynamicToolRegistry(handlers);
  }

  private async executePageUpdate(
    tool: "update_page" | "advanced_update_page",
    input: PageUpdateInput,
    context: NodexAgentDynamicExecutionContext,
  ): Promise<NodexAgentPageUpdateOutput> {
    const projectId = projectRequired(context);
    const request = tool === "update_page"
      ? {
          tool,
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input: input as NodexAgentV3ToolInput<"update_page">,
        }
      : {
          tool,
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input: input as NodexAgentV3ToolInput<"advanced_update_page">,
        };
    const prepared = await prepareAuthorizedWrite(context, {
      prepare: async () => {
        const result = (await this.writer.prepareNodexAgentPageUpdate(request)).result;
        if (!result.ok) return fail({ error: result.error });
        return result.value;
      },
      footprint: (value) => pageUpdateFootprint(projectId, tool, input, value.effects),
      authorization: (value) => ({
        tool,
        preview: pageUpdatePreview(tool, input, value.effects, value.targetMarkdown),
      }),
    });
    if (prepared.kind === "completed") return prepared.output;
    const mutationResult = await withExecutionTimeout(
      async () => await this.documentHub.applyDocumentMutation(prepared.mutation),
      this.executionTimeoutMs,
    );
    if (!mutationResult.ok) return fail(mapDocumentMutationFailure(mutationResult.error));
    const completed = (await this.writer.completeNodexAgentPageUpdate({
      tool,
      threadId: context.threadId,
      callId: context.callId,
      projectId,
      pageId: input.pageId,
      result: mutationResult.value,
    })).result;
    if (!completed.ok) return fail({ error: completed.error });
    return completed.output;
  }
}

export const nodexAgentV3DynamicService = new NodexAgentV3DynamicService();
