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
import type {
  NodexAgentResourceAccessOverlay,
  NodexAgentResourceGrantSpec,
  NodexAgentResourceIntent,
} from "../../shared/nodex-agent-resource-access";
import {
  createNodexV3DynamicToolRegistry,
  type NodexAgentV3ToolHandlers,
  type NodexAgentV3ToolInput,
} from "../codex/nodex-dynamic-tool-registry";
import type { NodexAgentV3DocumentHub, NodexAgentV3Writer } from "./dynamic-service-v3-port";
import {
  authorizationFootprint,
  type NodexAgentAuthorizationFootprint,
} from "./authorization-footprint";
import {
  authorizeNodexAgentResourceIntents,
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

export type { NodexAgentV3DocumentHub, NodexAgentV3Writer } from "./dynamic-service-v3-port";

export interface NodexAgentV3DynamicServiceOptions {
  readonly writer: NodexAgentV3Writer;
  readonly documentHub: NodexAgentV3DocumentHub;
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

function destinationIntent(
  destination: PageDestination,
  libraryId: string,
): NodexAgentResourceIntent {
  if (destination.kind === "library") {
    return {
      target: { kind: "library", libraryId },
      action: "create_child",
    };
  }
  if (destination.kind === "page") {
    return {
      target: { kind: "page", pageId: destination.pageId },
      action: "create_child",
    };
  }
  return {
    target: { kind: "data_source", dataSourceId: destination.dataSourceId },
    action: "create_child",
  };
}

function readPreview(
  title: string,
  summary: string,
  label: string,
  value: string,
): NodexAgentAuthorizationPreview {
  return {
    title,
    summary,
    details: [{ label, value }],
  };
}

function searchIntents(
  input: NodexAgentV3ToolInput<"search">,
): readonly NodexAgentResourceIntent[] {
  const scope = input.scope;
  if (!scope || scope.kind === "library") return [];
  if (scope.kind === "page") {
    return [
      {
        target: { kind: "page", pageId: scope.pageId },
        action: "read",
      },
    ];
  }
  if (scope.kind === "database") {
    return [
      {
        target: { kind: "database", databaseId: scope.databaseId },
        action: "read",
      },
    ];
  }
  return [
    {
      target: { kind: "data_source", dataSourceId: scope.dataSourceId },
      action: "read",
    },
  ];
}

function boundedMarkdownPreview(markdown: string): string | undefined {
  const normalized = markdown.trim();
  if (!normalized) return undefined;
  if (normalized.length <= MAX_AUTHORIZATION_MARKDOWN_PREVIEW_CHARS) return normalized;
  return `${normalized.slice(0, MAX_AUTHORIZATION_MARKDOWN_PREVIEW_CHARS)}\n…`;
}

async function recordTopLevelTaskPages(
  context: NodexAgentDynamicExecutionContext,
  destination: PageDestination,
  resourceAccess: NodexAgentResourceAccessOverlay | undefined,
  pageIds: readonly string[],
): Promise<void> {
  if (
    destination.kind !== "library" ||
    resourceAccess?.scope !== "task" ||
    !context.recordTaskResourceAccess
  )
    return;
  const grants: NodexAgentResourceGrantSpec[] = pageIds.map((pageId) => ({
    root: { kind: "page", pageId },
    access: "read_write",
  }));
  await context.recordTaskResourceAccess(grants);
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
  const preview = boundedMarkdownPreview(
    pages
      .map((page) => [`# ${page.title}`, page.targetMarkdown].filter(Boolean).join("\n\n"))
      .join("\n\n---\n\n"),
  );
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
        ? [
            {
              label: "Document scope",
              value: `${authorization.documentIds.length} Document${authorization.documentIds.length === 1 ? "" : "s"}`,
            },
          ]
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
        ? [
            {
              label: "Document scope",
              value: `${authorization.documentIds.length} Document${authorization.documentIds.length === 1 ? "" : "s"}`,
            },
          ]
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
    transformations: command.pages.map(
      (page) =>
        `page.create:${page.pageId}:body-blocks:${page.bodyBlockIds.length}:${command.input.destination.kind}`,
    ),
  });
}

function pageUpdateFootprint(
  projectId: string,
  tool: "update_page" | "advanced_update_page",
  input: PageUpdateInput,
  effects: AgentDocumentEditEffects,
): NodexAgentAuthorizationFootprint {
  const destructive =
    effects.deletedBlockIds.length > 0 ||
    (tool === "update_page" && "body" in input && input.body?.kind === "replace");
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
    transformations:
      tool === "update_page"
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
      ...command.documentHeads.map((head) => `document:${head.documentId}`),
    ],
    deletions: [],
    transformations: command.transfers.map((step) => {
      if (step.normalizedInput.mode !== "move") {
        throw new Error("Prepared Page move contains a non-move transfer");
      }
      return `page.move:${step.pageId}:${step.normalizedInput.from.kind}->${command.input.destination.kind}`;
    }),
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
      ...command.documentHeads.map((head) => `document:${head.documentId}`),
    ],
    deletions: [],
    transformations: [`page.duplicate:${command.input.pageId}:${command.input.destination.kind}`],
  });
}

function mapDocumentMutationFailure(error: {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}): ToolFailure {
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

  constructor(options: NodexAgentV3DynamicServiceOptions) {
    this.writer = options.writer;
    this.documentHub = options.documentHub;
    this.executionTimeoutMs = options.executionTimeoutMs ?? NODEX_AGENT_EXECUTION_TIMEOUT_MS;
    const handlers: NodexAgentV3ToolHandlers<NodexAgentDynamicExecutionContext> = {
      get_context: async ({ input, context }) => {
        const projectId = context.authority?.actorProjectId ?? null;
        const result = (
          await this.writer.readNodexAgentV3Tool({
            tool: "get_context",
            callId: context.callId,
            projectId,
            authority: context.authority,
            resourceAccess: context.resourceAccess,
            access: context.access,
            input,
          })
        ).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "get_context") throw new Error("Nodex v3 read tool mismatch");
        return result.output;
      },
      search: async ({ input, context }) => {
        const intents = searchIntents(input);
        const resourceAccess =
          intents.length > 0
            ? await authorizeNodexAgentResourceIntents(context, {
                intents,
                tool: "search",
                effect: "read",
                preview: readPreview(
                  "Search this Nodex resource",
                  "Search Pages and Blocks inside the requested resource.",
                  "Scope",
                  input.scope?.kind ?? "authorized Library resources",
                ),
              })
            : context.resourceAccess;
        const result = (
          await this.writer.readNodexAgentV3Tool({
            tool: "search",
            callId: context.callId,
            projectId: projectRequired(context),
            authority: context.authority ?? undefined,
            ...(resourceAccess ? { resourceAccess } : {}),
            input,
          })
        ).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "search") throw new Error("Nodex v3 read tool mismatch");
        return result.output;
      },
      fetch: async ({ input, context }) => {
        const resourceAccess = await authorizeNodexAgentResourceIntents(context, {
          intents: [
            {
              target: { kind: "page_or_block", id: input.id },
              action: "read",
            },
          ],
          tool: "fetch",
          effect: "read",
          preview: readPreview(
            "Read this Nodex Page or Block",
            "Read the requested content and its current metadata.",
            "Resource",
            input.id,
          ),
        });
        const result = (
          await this.writer.readNodexAgentV3Tool({
            tool: "fetch",
            callId: context.callId,
            projectId: projectRequired(context),
            authority: context.authority ?? undefined,
            ...(resourceAccess ? { resourceAccess } : {}),
            input,
          })
        ).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "fetch") throw new Error("Nodex v3 read tool mismatch");
        return result.output;
      },
      query_database_view: async ({ input, context }) => {
        const resourceAccess = await authorizeNodexAgentResourceIntents(context, {
          intents: [
            {
              target: { kind: "view", viewId: input.viewId },
              action: "read",
            },
          ],
          tool: "query_database_view",
          effect: "read",
          preview: readPreview(
            "Query this Nodex View",
            "Read rows and properties from the requested Database View.",
            "View",
            input.viewId,
          ),
        });
        const result = (
          await this.writer.readNodexAgentV3Tool({
            tool: "query_database_view",
            callId: context.callId,
            projectId: projectRequired(context),
            authority: context.authority ?? undefined,
            ...(resourceAccess ? { resourceAccess } : {}),
            input,
          })
        ).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "query_database_view") {
          throw new Error("Nodex v3 read tool mismatch");
        }
        return result.output;
      },
      query_data_source: async ({ input, context }) => {
        const resourceAccess = await authorizeNodexAgentResourceIntents(context, {
          intents: [
            {
              target: { kind: "data_source", dataSourceId: input.dataSourceId },
              action: "read",
            },
          ],
          tool: "query_data_source",
          effect: "read",
          preview: readPreview(
            "Query this Nodex Data Source",
            "Read rows and properties from the requested Data Source.",
            "Data Source",
            input.dataSourceId,
          ),
        });
        const result = (
          await this.writer.readNodexAgentV3Tool({
            tool: "query_data_source",
            callId: context.callId,
            projectId: projectRequired(context),
            authority: context.authority ?? undefined,
            ...(resourceAccess ? { resourceAccess } : {}),
            input,
          })
        ).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "query_data_source") {
          throw new Error("Nodex v3 read tool mismatch");
        }
        return result.output;
      },
      create_pages: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const prepared = await prepareAuthorizedWrite(context, {
          intents: [destinationIntent(input.destination, context.authority?.libraryId ?? "")],
          prepare: async (resourceAccess) => {
            const request = {
              threadId: context.threadId,
              callId: context.callId,
              projectId,
              authority: context.authority ?? undefined,
              ...(resourceAccess ? { resourceAccess } : {}),
              input,
            };
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
          async () =>
            await this.documentHub.executeNodexAgentCreatePages(
              prepared.command,
              prepared.documentHeads,
            ),
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ error: result.error });
        await recordTopLevelTaskPages(
          context,
          input.destination,
          prepared.command.resourceAccess,
          result.value.output.data.pages.map((page) => page.pageId),
        );
        return result.value.output;
      },
      update_page: async ({ input, context }) =>
        await this.executePageUpdate("update_page", input, context),
      advanced_update_page: async ({ input, context }) =>
        await this.executePageUpdate("advanced_update_page", input, context),
      move_pages: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const prepared = await prepareAuthorizedWrite(context, {
          intents: [
            ...input.pageIds.map((pageId) => ({
              target: { kind: "page" as const, pageId },
              action: "move" as const,
            })),
            destinationIntent(input.destination, context.authority?.libraryId ?? ""),
          ],
          prepare: async (resourceAccess) => {
            const request = {
              threadId: context.threadId,
              callId: context.callId,
              projectId,
              authority: context.authority ?? undefined,
              ...(resourceAccess ? { resourceAccess } : {}),
              input,
            };
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
        await recordTopLevelTaskPages(
          context,
          input.destination,
          prepared.command.resourceAccess,
          result.value.output.data.pages.map((page) => page.pageId),
        );
        return result.value.output;
      },
      duplicate_page: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const prepared = await prepareAuthorizedWrite(context, {
          intents: [
            {
              target: { kind: "page", pageId: input.pageId },
              action: "read",
            },
            destinationIntent(input.destination, context.authority?.libraryId ?? ""),
          ],
          prepare: async (resourceAccess) => {
            const request = {
              threadId: context.threadId,
              callId: context.callId,
              projectId,
              authority: context.authority ?? undefined,
              ...(resourceAccess ? { resourceAccess } : {}),
              input,
            };
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
        await recordTopLevelTaskPages(context, input.destination, prepared.command.resourceAccess, [
          result.value.output.data.pageId,
        ]);
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
    const prepared = await prepareAuthorizedWrite(context, {
      intents: [
        {
          target: { kind: "page", pageId: input.pageId },
          action: "write",
        },
      ],
      prepare: async (resourceAccess) => {
        const identity = {
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          authority: context.authority ?? undefined,
          ...(resourceAccess ? { resourceAccess } : {}),
        };
        const request =
          tool === "update_page"
            ? {
                ...identity,
                tool,
                input: input as NodexAgentV3ToolInput<"update_page">,
              }
            : {
                ...identity,
                tool,
                input: input as NodexAgentV3ToolInput<"advanced_update_page">,
              };
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
      async () =>
        await this.documentHub.applyDocumentMutation(
          prepared.mutation,
          context.authority
            ? {
                authority: context.authority,
                resource: { kind: "page", pageId: input.pageId },
                ...(prepared.resourceAccess ? { resourceAccess: prepared.resourceAccess } : {}),
                callId: context.callId,
              }
            : undefined,
        ),
      this.executionTimeoutMs,
    );
    if (!mutationResult.ok) return fail(mapDocumentMutationFailure(mutationResult.error));
    const completed = (
      await this.writer.completeNodexAgentPageUpdate({
        tool,
        threadId: context.threadId,
        callId: context.callId,
        projectId,
        authority: context.authority ?? undefined,
        ...(prepared.resourceAccess ? { resourceAccess: prepared.resourceAccess } : {}),
        pageId: input.pageId,
        result: mutationResult.value,
      })
    ).result;
    if (!completed.ok) return fail({ error: completed.error });
    return completed.output;
  }
}
