import type {
  AgentDocumentEditEffects,
  NodexAgentAuthorizationPreview,
  NodexAgentCardUpdateOutput,
  NodexAgentCreateCardsCommand,
  NodexAgentDuplicateCardCommand,
  NodexAgentMoveCardsCommand,
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
} from "./dynamic-service";

const NODEX_AGENT_EXECUTION_TIMEOUT_MS = 30_000;
const MAX_AUTHORIZATION_MARKDOWN_PREVIEW_CHARS = 1_600;

type CardDestination =
  | { readonly kind: "space" }
  | { readonly kind: "card"; readonly cardId: string }
  | { readonly kind: "database"; readonly databaseBlockId: string };

type CardUpdateInput =
  | NodexAgentV3ToolInput<"update_card">
  | NodexAgentV3ToolInput<"advanced_update_card">;

export type NodexAgentV3Writer = Pick<
  typeof blockMutationWriter,
  | "readNodexAgentV3Tool"
  | "prepareNodexAgentCardUpdate"
  | "completeNodexAgentCardUpdate"
  | "prepareNodexAgentCreateCards"
  | "prepareNodexAgentDuplicateCard"
  | "prepareNodexAgentMoveCards"
>;

export type NodexAgentV3DocumentHub = Pick<
  typeof documentSyncHub,
  | "applyDocumentMutation"
  | "executeNodexAgentCreateCards"
  | "executeNodexAgentDuplicateCard"
  | "executeNodexAgentMoveCards"
>;

export interface NodexAgentV3DynamicServiceOptions {
  readonly writer?: NodexAgentV3Writer;
  readonly documentHub?: NodexAgentV3DocumentHub;
  readonly executionTimeoutMs?: number;
}

function destinationLabel(destination: CardDestination): string {
  if (destination.kind === "space") return "Project Space";
  if (destination.kind === "card") return `Card ${destination.cardId}`;
  return `Database ${destination.databaseBlockId}`;
}

function destinationResource(destination: CardDestination): string {
  if (destination.kind === "space") return "space";
  if (destination.kind === "card") return `card:${destination.cardId}`;
  return `database:${destination.databaseBlockId}`;
}

function sourceResource(source:
  | { readonly kind: "space" }
  | { readonly kind: "document"; readonly documentId: string }
  | { readonly kind: "database"; readonly databaseBlockId: string }
): string {
  if (source.kind === "space") return "space";
  if (source.kind === "document") return `document:${source.documentId}`;
  return `database:${source.databaseBlockId}`;
}

function boundedMarkdownPreview(markdown: string): string | undefined {
  const normalized = markdown.trim();
  if (!normalized) return undefined;
  if (normalized.length <= MAX_AUTHORIZATION_MARKDOWN_PREVIEW_CHARS) return normalized;
  return `${normalized.slice(0, MAX_AUTHORIZATION_MARKDOWN_PREVIEW_CHARS)}\n…`;
}

function createCardsPreview(
  input: NodexAgentV3ToolInput<"create_cards">,
  cards: readonly {
    readonly title: string;
    readonly bodyBlockCount: number;
    readonly targetMarkdown: string;
  }[],
): NodexAgentAuthorizationPreview {
  const blocks = cards.reduce((total, card) => total + card.bodyBlockCount, 0);
  const preview = boundedMarkdownPreview(cards.map((card) => [
    `# ${card.title}`,
    card.targetMarkdown,
  ].filter(Boolean).join("\n\n")).join("\n\n---\n\n"));
  return {
    title: `Create ${cards.length} Card${cards.length === 1 ? "" : "s"}`,
    summary: `Create ${cards.length} complete Card${cards.length === 1 ? "" : "s"} with ${blocks} body Block${blocks === 1 ? "" : "s"}.`,
    details: [
      { label: "Destination", value: destinationLabel(input.destination) },
      { label: "Cards", value: cards.map((card) => card.title).join(", ") },
    ],
    ...(preview ? { markdownPreview: preview } : {}),
  };
}

function cardUpdatePreview(
  tool: "update_card" | "advanced_update_card",
  input: CardUpdateInput,
  effects: AgentDocumentEditEffects,
  targetMarkdown: string,
): NodexAgentAuthorizationPreview {
  const counts = [
    effects.createdBlockIds.length > 0 ? `${effects.createdBlockIds.length} create` : null,
    effects.updatedBlockIds.length > 0 ? `${effects.updatedBlockIds.length} update` : null,
    effects.movedBlockIds.length > 0 ? `${effects.movedBlockIds.length} move` : null,
    effects.deletedBlockIds.length > 0 ? `${effects.deletedBlockIds.length} delete` : null,
    tool === "update_card" && "title" in input && input.title ? "title update" : null,
  ].filter((entry): entry is string => entry !== null);
  const preview = boundedMarkdownPreview(targetMarkdown);
  return {
    title: tool === "update_card" ? "Update Card" : "Advanced Card update",
    summary: counts.length > 0 ? counts.join(", ") : "Update Card content.",
    details: [
      { label: "Card", value: input.cardId },
      ...(tool === "update_card" && "body" in input && input.body
        ? [{ label: "Method", value: input.body.kind }]
        : []),
    ],
    ...(preview ? { markdownPreview: preview } : {}),
  };
}

function moveCardsPreview(
  input: NodexAgentV3ToolInput<"move_cards">,
  authorization: NodexAgentTransferAuthorizationEvidence,
): NodexAgentAuthorizationPreview {
  return {
    title: `Move ${input.cardIds.length} Card${input.cardIds.length === 1 ? "" : "s"}`,
    summary: "Move the selected Cards and their complete owned content atomically.",
    details: [
      { label: "Destination", value: destinationLabel(input.destination) },
      { label: "Cards", value: input.cardIds.join(", ") },
      ...(authorization.documentIds.length > 0
        ? [{
            label: "Document scope",
            value: `${authorization.documentIds.length} Document${authorization.documentIds.length === 1 ? "" : "s"}`,
          }]
        : []),
    ],
  };
}

function duplicateCardPreview(
  input: NodexAgentV3ToolInput<"duplicate_card">,
  authorization: NodexAgentTransferAuthorizationEvidence,
): NodexAgentAuthorizationPreview {
  return {
    title: "Duplicate Card",
    summary: "Copy the complete Card ownership subtree with fresh identities.",
    details: [
      { label: "Source Card", value: input.cardId },
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

function createCardsFootprint(
  projectId: string,
  command: NodexAgentCreateCardsCommand,
): NodexAgentAuthorizationFootprint {
  return authorizationFootprint({
    tool: "create_cards",
    projectId,
    effect: "write",
    resources: [
      destinationResource(command.input.destination),
      ...command.cards.map((card) => `card:${card.cardId}`),
    ],
    deletions: [],
    transformations: command.cards.map((card) =>
      `card.create:${card.cardId}:body-blocks:${card.bodyBlockIds.length}`
    ),
  });
}

function cardUpdateFootprint(
  projectId: string,
  tool: "update_card" | "advanced_update_card",
  input: CardUpdateInput,
  effects: AgentDocumentEditEffects,
): NodexAgentAuthorizationFootprint {
  const destructive = effects.deletedBlockIds.length > 0
    || (tool === "update_card"
      && "body" in input
      && input.body?.kind === "replace");
  return authorizationFootprint({
    tool,
    projectId,
    effect: destructive ? "destructive" : "write",
    resources: [
      `card:${input.cardId}`,
      ...effects.createdBlockIds.map((id) => `block:${id}`),
      ...effects.updatedBlockIds.map((id) => `block:${id}`),
      ...effects.movedBlockIds.map((id) => `block:${id}`),
      ...effects.deletedBlockIds.map((id) => `block:${id}`),
    ],
    deletions: [
      ...effects.deletedBlockIds.map((id) => `block:${id}`),
      ...effects.deletedOwnerBlockIds.map((id) => `owner:${id}`),
    ],
    transformations: tool === "update_card"
      ? [
          ...("title" in input && input.title ? ["title.set"] : []),
          ...("body" in input && input.body ? [`body.${input.body.kind}`] : []),
        ]
      : ["stable-block-edits"],
  });
}

function moveCardsFootprint(
  projectId: string,
  command: NodexAgentMoveCardsCommand,
): NodexAgentAuthorizationFootprint {
  const sources = command.transfers.map((step) =>
    step.normalizedInput.mode === "move"
      ? sourceResource(step.normalizedInput.from)
      : "copy-source:current"
  );
  return authorizationFootprint({
    tool: "move_cards",
    projectId,
    effect: "write",
    resources: [
      destinationResource(command.input.destination),
      ...sources,
      ...command.input.cardIds.map((cardId) => `card:${cardId}`),
      ...command.leaseDocuments.map((lease) => `document:${lease.documentId}`),
    ],
    deletions: [],
    transformations: command.input.cardIds.map((cardId) =>
      `card.move:${cardId}->${command.input.destination.kind}`
    ),
  });
}

function duplicateCardFootprint(
  projectId: string,
  command: NodexAgentDuplicateCardCommand,
): NodexAgentAuthorizationFootprint {
  return authorizationFootprint({
    tool: "duplicate_card",
    projectId,
    effect: "write",
    resources: [
      `card:${command.input.cardId}`,
      destinationResource(command.input.destination),
      ...command.leaseDocuments.map((lease) => `document:${lease.documentId}`),
    ],
    deletions: [],
    transformations: [`card.duplicate:${command.input.cardId}->${command.input.destination.kind}`],
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
      advanced_query_database: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentV3Tool({
          tool: "advanced_query_database",
          projectId: projectRequired(context),
          input,
        })).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "advanced_query_database") {
          throw new Error("Nodex v3 read tool mismatch");
        }
        return result.output;
      },
      create_cards: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const request = {
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        };
        const prepared = await prepareAuthorizedWrite(context, {
          prepare: async () => {
            const result = (await this.writer.prepareNodexAgentCreateCards(request)).result;
            if (!result.ok) return fail({ error: result.error });
            return result.value;
          },
          footprint: (value) => createCardsFootprint(projectId, value.command),
          authorization: (value) => ({
            tool: "create_cards",
            preview: createCardsPreview(input, value.previews),
          }),
        });
        if (prepared.kind === "completed") return prepared.output;
        const result = await withExecutionTimeout(
          async () => await this.documentHub.executeNodexAgentCreateCards(
            prepared.command,
            prepared.leaseDocuments,
          ),
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ error: result.error });
        return result.value.output;
      },
      update_card: async ({ input, context }) =>
        await this.executeCardUpdate("update_card", input, context),
      advanced_update_card: async ({ input, context }) =>
        await this.executeCardUpdate("advanced_update_card", input, context),
      move_cards: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const request = {
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        };
        const prepared = await prepareAuthorizedWrite(context, {
          prepare: async () => {
            const result = (await this.writer.prepareNodexAgentMoveCards(request)).result;
            if (!result.ok) return fail({ error: result.error });
            return result.value;
          },
          footprint: (value) => moveCardsFootprint(projectId, value.command),
          authorization: (value) => ({
            tool: "move_cards",
            preview: moveCardsPreview(input, value.authorization),
          }),
        });
        if (prepared.kind === "completed") return prepared.output;
        const result = await withExecutionTimeout(
          async () => await this.documentHub.executeNodexAgentMoveCards(prepared.command),
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ error: result.error });
        return result.value.output;
      },
      duplicate_card: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const request = {
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        };
        const prepared = await prepareAuthorizedWrite(context, {
          prepare: async () => {
            const result = (await this.writer.prepareNodexAgentDuplicateCard(request)).result;
            if (!result.ok) return fail({ error: result.error });
            return result.value;
          },
          footprint: (value) => duplicateCardFootprint(projectId, value.command),
          authorization: (value) => ({
            tool: "duplicate_card",
            preview: duplicateCardPreview(input, value.authorization),
          }),
        });
        if (prepared.kind === "completed") return prepared.output;
        const result = await withExecutionTimeout(
          async () => await this.documentHub.executeNodexAgentDuplicateCard(prepared.command),
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ error: result.error });
        return result.value.output;
      },
    };
    this.registry = createNodexV3DynamicToolRegistry(handlers);
  }

  private async executeCardUpdate(
    tool: "update_card" | "advanced_update_card",
    input: CardUpdateInput,
    context: NodexAgentDynamicExecutionContext,
  ): Promise<NodexAgentCardUpdateOutput> {
    const projectId = projectRequired(context);
    const request = tool === "update_card"
      ? {
          tool,
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input: input as NodexAgentV3ToolInput<"update_card">,
        }
      : {
          tool,
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input: input as NodexAgentV3ToolInput<"advanced_update_card">,
        };
    const prepared = await prepareAuthorizedWrite(context, {
      prepare: async () => {
        const result = (await this.writer.prepareNodexAgentCardUpdate(request)).result;
        if (!result.ok) return fail({ error: result.error });
        return result.value;
      },
      footprint: (value) => cardUpdateFootprint(projectId, tool, input, value.effects),
      authorization: (value) => ({
        tool,
        preview: cardUpdatePreview(tool, input, value.effects, value.targetMarkdown),
      }),
    });
    if (prepared.kind === "completed") return prepared.output;
    const mutationResult = await withExecutionTimeout(
      async () => await this.documentHub.applyDocumentMutation(prepared.mutation),
      this.executionTimeoutMs,
    );
    if (!mutationResult.ok) return fail(mapDocumentMutationFailure(mutationResult.error));
    const completed = (await this.writer.completeNodexAgentCardUpdate({
      tool,
      threadId: context.threadId,
      callId: context.callId,
      projectId,
      cardId: input.cardId,
      result: mutationResult.value,
    })).result;
    if (!completed.ok) return fail({ error: completed.error });
    return completed.output;
  }
}

export const nodexAgentV3DynamicService = new NodexAgentV3DynamicService();
