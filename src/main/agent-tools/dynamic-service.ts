import {
  type CreateInput,
  type EditDatabaseInput,
  type EditDocumentInput,
  type NodexAgentAccess,
  type NodexAgentAuthorizationDecision,
  type NodexAgentAuthorizationPreview,
  type NodexAgentTransferAuthorizationEvidence,
  type NodexAgentV2ToolName,
  type NodexAgentV3ToolName,
  type ToolFailure,
  type TransferBlocksInput,
} from "../../shared/nodex-agent-tools";
import { blockMutationWriter } from "../block-mutation-writer";
import { documentSyncHub } from "../document-sync-runtime";
import {
  createNodexDynamicToolRegistry,
  type NodexAgentToolHandlers,
} from "../codex/nodex-dynamic-tool-registry";
import type { DynamicToolEffect } from "../codex/dynamic-tool-registry";
import {
  authorizationFootprint,
  sameAuthorizationFootprint,
  type NodexAgentAuthorizationFootprint,
} from "./authorization-footprint";

const NODEX_AGENT_EXECUTION_TIMEOUT_MS = 30_000;
const MAX_AUTHORIZATION_NFM_PREVIEW_CHARS = 1_600;

export type NodexAgentWriteTool =
  | Extract<
      NodexAgentV2ToolName,
      "create" | "edit_document" | "transfer_blocks" | "edit_database"
    >
  | Extract<
      NodexAgentV3ToolName,
      | "create_cards"
      | "update_card"
      | "advanced_update_card"
      | "move_cards"
      | "duplicate_card"
    >;

export interface NodexAgentDynamicAuthorizationInput {
  readonly threadId: string;
  readonly callId: string;
  readonly projectId: string;
  readonly tool: NodexAgentWriteTool;
  readonly effect: Extract<DynamicToolEffect, "write" | "destructive">;
  readonly preview: NodexAgentAuthorizationPreview;
}

export interface NodexAgentDynamicExecutionContext {
  readonly threadId: string;
  readonly callId: string;
  readonly projectId: string | null;
  readonly access: NodexAgentAccess;
  readonly authorize: (
    input: NodexAgentDynamicAuthorizationInput,
  ) => Promise<NodexAgentAuthorizationDecision | "unavailable">;
}

export type NodexAgentWriter = Pick<
  typeof blockMutationWriter,
  | "readNodexAgentTool"
  | "prepareNodexAgentDocumentEdit"
  | "completeNodexAgentDocumentEdit"
  | "prepareNodexAgentCreate"
  | "prepareNodexAgentTransfer"
  | "prepareNodexAgentDatabaseEdit"
  | "executeNodexAgentDatabaseEdit"
>;

export type NodexAgentDocumentHub = Pick<
  typeof documentSyncHub,
  "applyDocumentMutation" | "executeNodexAgentCreate" | "executeNodexAgentTransfer"
>;

export interface NodexAgentDynamicServiceOptions {
  readonly writer?: NodexAgentWriter;
  readonly documentHub?: NodexAgentDocumentHub;
  readonly executionTimeoutMs?: number;
}

export function toolFailure(
  code: ToolFailure["error"]["code"],
  message: string,
  recovery: ToolFailure["error"]["recovery"],
  retryable = false,
): ToolFailure {
  return {
    error: { code, message, retryable, recovery },
  };
}

export class NodexAgentDynamicToolFailure extends Error {
  constructor(readonly failure: ToolFailure) {
    super(failure.error.message);
    this.name = "NodexAgentDynamicToolFailure";
  }
}

export function fail(failure: ToolFailure): never {
  throw new NodexAgentDynamicToolFailure(failure);
}

export function projectRequired(context: NodexAgentDynamicExecutionContext): string {
  if (context.projectId) return context.projectId;
  return fail(toolFailure(
    "project_context_required",
    "This Nodex tool requires a task bound to a Project",
    "start_new_task",
  ));
}

function titleText(input: CreateInput["resource"]["title"]): string {
  if (input.kind === "plain") return input.text || "Untitled Card";
  const text = input.richText.flatMap((item) => {
    if (item.type === "text" || item.type === "link") return [item.text];
    if (item.type === "linebreak") return [" "];
    return [];
  }).join("").trim();
  return text || "Rich-text Card";
}

function destinationLabel(
  destination: CreateInput["destination"] | TransferBlocksInput["destination"],
): string {
  if (destination.kind === "space") return "Project Space";
  if (destination.kind === "document") return `Document ${destination.documentId}`;
  const view = destination.view ? ` via View ${destination.view.viewId}` : " without View placement";
  return `Database ${destination.databaseBlockId}${view}`;
}

function boundedNfmPreview(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length <= MAX_AUTHORIZATION_NFM_PREVIEW_CHARS) return normalized;
  return `${normalized.slice(0, MAX_AUTHORIZATION_NFM_PREVIEW_CHARS)}\n…`;
}

function createPreview(
  input: CreateInput,
  bodyBlockCount: number,
  targetNfm: string,
): NodexAgentAuthorizationPreview {
  const title = titleText(input.resource.title);
  const nfmPreview = boundedNfmPreview(targetNfm);
  return {
    title: `Create “${title}”`,
    summary: `Create one Card with ${bodyBlockCount} body Block${bodyBlockCount === 1 ? "" : "s"}.`,
    details: [
      { label: "Destination", value: destinationLabel(input.destination) },
      { label: "Card", value: title },
    ],
    ...(nfmPreview ? { nfmPreview } : {}),
  };
}

function editDocumentPreview(
  input: EditDocumentInput,
  effects: {
    readonly createdBlockIds: readonly string[];
    readonly updatedBlockIds: readonly string[];
    readonly movedBlockIds: readonly string[];
    readonly deletedBlockIds: readonly string[];
  },
  targetNfm: string,
): NodexAgentAuthorizationPreview {
  const changes = [
    effects.createdBlockIds.length > 0 ? `${effects.createdBlockIds.length} create` : null,
    effects.updatedBlockIds.length > 0 ? `${effects.updatedBlockIds.length} update` : null,
    effects.movedBlockIds.length > 0 ? `${effects.movedBlockIds.length} move` : null,
    effects.deletedBlockIds.length > 0 ? `${effects.deletedBlockIds.length} delete` : null,
    input.title ? "title update" : null,
  ].filter((entry): entry is string => entry !== null);
  const nfmPreview = boundedNfmPreview(targetNfm);
  return {
    title: "Edit Nodex document",
    summary: changes.length > 0 ? changes.join(", ") : "Update document content.",
    details: [
      { label: "Document", value: input.documentId },
      ...(input.body ? [{ label: "Method", value: input.body.kind }] : []),
    ],
    ...(nfmPreview ? { nfmPreview } : {}),
  };
}

function transferPreview(
  input: TransferBlocksInput,
  authorization: NodexAgentTransferAuthorizationEvidence,
): NodexAgentAuthorizationPreview {
  const verb = input.mode === "copy" ? "Copy" : "Move";
  const transformations = Object.entries(authorization.roots)
    .filter(([, evidence]) => evidence.transformation !== "preserved")
    .map(([blockId, evidence]) => `${blockId}: ${evidence.transformation}`);
  return {
    title: `${verb} ${input.blockIds.length} Nodex Block${input.blockIds.length === 1 ? "" : "s"}`,
    summary: `${verb} the selected root Block${input.blockIds.length === 1 ? "" : "s"} and their owned content.`,
    details: [
      { label: "Destination", value: destinationLabel(input.destination) },
      { label: "Roots", value: input.blockIds.join(", ") },
      ...(transformations.length > 0
        ? [{ label: "Transformations", value: transformations.join(", ") }]
        : []),
      ...(authorization.documentIds.length > 0
        ? [{
            label: "Document scope",
            value: `${authorization.documentIds.length} Document${authorization.documentIds.length === 1 ? "" : "s"}`,
          }]
        : []),
    ],
  };
}

function editDatabasePreview(input: EditDatabaseInput): NodexAgentAuthorizationPreview {
  const counts = new Map<string, number>();
  for (const edit of input.edits) counts.set(edit.kind, (counts.get(edit.kind) ?? 0) + 1);
  return {
    title: "Edit Nodex Database",
    summary: `Apply ${input.edits.length} typed value or View placement edit${input.edits.length === 1 ? "" : "s"}.`,
    details: [
      { label: "Database", value: input.databaseBlockId },
      {
        label: "Operations",
        value: [...counts].map(([kind, count]) => `${count} ${kind}`).join(", "),
      },
    ],
  };
}

function destinationResource(
  destination:
    | { readonly kind: "space" }
    | { readonly kind: "document"; readonly documentId: string }
    | { readonly kind: "database"; readonly databaseBlockId: string },
): string {
  if (destination.kind === "space") return "space";
  if (destination.kind === "document") return `document:${destination.documentId}`;
  return `database:${destination.databaseBlockId}`;
}

function createFootprint(input: {
  readonly projectId: string;
  readonly request: CreateInput;
  readonly bodyBlockCount: number;
}): NodexAgentAuthorizationFootprint {
  return authorizationFootprint({
    tool: "create",
    projectId: input.projectId,
    effect: "write",
    resources: [destinationResource(input.request.destination)],
    deletions: [],
    transformations: ["card.create", `body-blocks:${input.bodyBlockCount}`],
  });
}

function documentFootprint(input: {
  readonly projectId: string;
  readonly request: EditDocumentInput;
  readonly effects: {
    readonly createdBlockIds: readonly string[];
    readonly updatedBlockIds: readonly string[];
    readonly movedBlockIds: readonly string[];
    readonly deletedBlockIds: readonly string[];
    readonly deletedOwnerBlockIds: readonly string[];
  };
}): NodexAgentAuthorizationFootprint {
  const destructive = input.effects.deletedBlockIds.length > 0
    || input.request.body?.kind === "nfm.replace";
  return authorizationFootprint({
    tool: "edit_document",
    projectId: input.projectId,
    effect: destructive ? "destructive" : "write",
    resources: [
      `document:${input.request.documentId}`,
      ...input.effects.createdBlockIds.map((id) => `block:${id}`),
      ...input.effects.updatedBlockIds.map((id) => `block:${id}`),
      ...input.effects.movedBlockIds.map((id) => `block:${id}`),
      ...input.effects.deletedBlockIds.map((id) => `block:${id}`),
    ],
    deletions: [
      ...input.effects.deletedBlockIds.map((id) => `block:${id}`),
      ...input.effects.deletedOwnerBlockIds.map((id) => `owner:${id}`),
    ],
    transformations: [
      ...(input.request.title ? ["title.set"] : []),
      ...(input.request.body ? [input.request.body.kind] : []),
    ],
  });
}

function transferFootprint(input: {
  readonly projectId: string;
  readonly request: TransferBlocksInput;
  readonly authorization: NodexAgentTransferAuthorizationEvidence;
}): NodexAgentAuthorizationFootprint {
  const source = input.request.mode === "move"
    ? destinationResource(input.request.from)
    : "copy-source:current";
  return authorizationFootprint({
    tool: "transfer_blocks",
    projectId: input.projectId,
    effect: "write",
    resources: [
      source,
      destinationResource(input.request.destination),
      ...input.request.blockIds.map((id) => `block:${id}`),
      ...input.authorization.documentIds.map((id) => `document:${id}`),
    ],
    deletions: [],
    transformations: input.request.blockIds.map((id) => {
      const evidence = input.authorization.roots[id];
      if (!evidence) return `${input.request.mode}:${id}:unknown`;
      const reason = evidence.wrapperReason ? `:${evidence.wrapperReason}` : "";
      return `${input.request.mode}:${id}:${evidence.type}:${evidence.transformation}${reason}->${input.request.destination.kind}`;
    }),
  });
}

function databaseFootprint(input: {
  readonly projectId: string;
  readonly request: EditDatabaseInput;
}): NodexAgentAuthorizationFootprint {
  return authorizationFootprint({
    tool: "edit_database",
    projectId: input.projectId,
    effect: "write",
    resources: [
      `database:${input.request.databaseBlockId}`,
      ...input.request.edits.flatMap((edit) => {
        if (edit.kind === "view.place") {
          return [
            `view:${edit.viewId}`,
            ...edit.items.map((item) => `placement:${edit.viewId}:${item.blockId}`),
          ];
        }
        return [`value:${edit.blockId}:${edit.propertyId}`];
      }),
    ],
    deletions: [],
    transformations: input.request.edits.map((edit) => edit.kind),
  });
}

function requireStableAuthorizationFootprint(
  before: NodexAgentAuthorizationFootprint,
  after: NodexAgentAuthorizationFootprint,
): void {
  if (sameAuthorizationFootprint(before, after)) return;
  fail(toolFailure(
    "conflict",
    "The mutation scope changed while authorization was pending; review and retry the call",
    "retry_same",
    true,
  ));
}

async function requireAuthorization(
  context: NodexAgentDynamicExecutionContext,
  input: Omit<NodexAgentDynamicAuthorizationInput, "threadId" | "callId" | "projectId">,
): Promise<void> {
  const projectId = projectRequired(context);
  const decision = await context.authorize({
    threadId: context.threadId,
    callId: context.callId,
    projectId,
    ...input,
  });
  if (decision === "allow_once" || decision === "allow_task") return;
  if (decision === "unavailable") {
    fail(toolFailure(
      "authorization_required",
      "A visible task owner is required to authorize this Nodex write",
      "request_authorization",
    ));
  }
  fail(toolFailure(
    "authorization_denied",
    "The Nodex write was denied",
    "none",
  ));
}

type CompletedWritePreflight<TOutput> = {
  readonly kind: "completed";
  readonly output: TOutput;
};

export async function prepareAuthorizedWrite<
  TOutput,
  TPrepared extends { readonly kind: "prepared" },
>(
  context: NodexAgentDynamicExecutionContext,
  input: {
    readonly prepare: () => Promise<CompletedWritePreflight<TOutput> | TPrepared>;
    readonly footprint: (prepared: TPrepared) => NodexAgentAuthorizationFootprint;
    readonly authorization: (
      prepared: TPrepared,
    ) => Omit<
      NodexAgentDynamicAuthorizationInput,
      "threadId" | "callId" | "projectId" | "effect"
    >;
  },
): Promise<CompletedWritePreflight<TOutput> | TPrepared> {
  const prepared = await input.prepare();
  if (prepared.kind === "completed") return prepared;

  const approvedFootprint = input.footprint(prepared);
  await requireAuthorization(context, {
    ...input.authorization(prepared),
    effect: approvedFootprint.effect,
  });

  const refreshed = await input.prepare();
  if (refreshed.kind === "completed") return refreshed;
  requireStableAuthorizationFootprint(
    approvedFootprint,
    input.footprint(refreshed),
  );
  return refreshed;
}

export async function withExecutionTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new NodexAgentDynamicToolFailure(toolFailure(
          "timeout",
          "The Nodex write did not finish within its execution window; retry the same call identity",
          "retry_same",
          true,
        ))), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class NodexAgentDynamicService {
  private readonly writer: NodexAgentWriter;
  private readonly documentHub: NodexAgentDocumentHub;
  private readonly executionTimeoutMs: number;
  readonly registry;

  constructor(options: NodexAgentDynamicServiceOptions = {}) {
    this.writer = options.writer ?? blockMutationWriter;
    this.documentHub = options.documentHub ?? documentSyncHub;
    this.executionTimeoutMs = options.executionTimeoutMs
      ?? NODEX_AGENT_EXECUTION_TIMEOUT_MS;
    const handlers: NodexAgentToolHandlers<NodexAgentDynamicExecutionContext> = {
      get_context: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentTool({
          tool: "get_context",
          projectId: context.projectId,
          access: context.access,
          input,
        })).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "get_context") throw new Error("Nodex read tool mismatch");
        return result.output;
      },
      get_block: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentTool({
          tool: "get_block",
          projectId: projectRequired(context),
          input,
        })).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "get_block") throw new Error("Nodex read tool mismatch");
        return result.output;
      },
      search: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentTool({
          tool: "search",
          projectId: projectRequired(context),
          input,
        })).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "search") throw new Error("Nodex read tool mismatch");
        return result.output;
      },
      query_database: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentTool({
          tool: "query_database",
          projectId: projectRequired(context),
          input,
        })).result;
        if (!result.ok) return fail({ error: result.error });
        if (result.tool !== "query_database") throw new Error("Nodex read tool mismatch");
        return result.output;
      },
      create: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const request = {
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        };
        const prepared = await prepareAuthorizedWrite(context, {
          prepare: async () => {
            const result = (await this.writer.prepareNodexAgentCreate(request)).result;
            if (!result.ok) return fail({ error: result.error });
            return result.value;
          },
          footprint: (value) => createFootprint({
            projectId,
            request: input,
            bodyBlockCount: value.createdBodyBlockIds.length,
          }),
          authorization: (value) => ({
            tool: "create",
            preview: createPreview(
              input,
              value.createdBodyBlockIds.length,
              value.targetNfm,
            ),
          }),
        });
        if (prepared.kind === "completed") return prepared.output;
        const command = prepared.command;
        const leaseDocuments = prepared.leaseDocuments;
        const result = await withExecutionTimeout(
          async () => await this.documentHub.executeNodexAgentCreate(
            command,
            leaseDocuments,
          ),
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ error: result.error });
        return result.value.output;
      },
      edit_document: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const request = {
          tool: "edit_document" as const,
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        };
        const prepared = await prepareAuthorizedWrite(context, {
          prepare: async () => {
            const result = (await this.writer.prepareNodexAgentDocumentEdit(request)).result;
            if (!result.ok) return fail({ error: result.error });
            return result.value;
          },
          footprint: (value) => documentFootprint({
            projectId,
            request: input,
            effects: value.effects,
          }),
          authorization: (value) => ({
            tool: "edit_document",
            preview: editDocumentPreview(
              input,
              value.effects,
              value.targetNfm,
            ),
          }),
        });
        if (prepared.kind === "completed") return prepared.output;
        const mutation = prepared.mutation;
        const mutationResult = await withExecutionTimeout(
          async () => await this.documentHub.applyDocumentMutation(
            mutation,
          ),
          this.executionTimeoutMs,
        );
        if (!mutationResult.ok) {
          const conflict = mutationResult.error.code.includes("conflict");
          return fail(toolFailure(
            conflict ? "conflict" : "internal_error",
            mutationResult.error.message,
            conflict ? "get_block_again" : "retry_same",
            mutationResult.error.retryable,
          ));
        }
        const completed = (await this.writer.completeNodexAgentDocumentEdit({
          tool: "edit_document",
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          result: mutationResult.value,
        })).result;
        if (!completed.ok) return fail({ error: completed.error });
        return completed.output;
      },
      transfer_blocks: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const request = {
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        };
        const prepared = await prepareAuthorizedWrite(context, {
          prepare: async () => {
            const result = (await this.writer.prepareNodexAgentTransfer(request)).result;
            if (!result.ok) return fail({ error: result.error });
            return result.value;
          },
          footprint: (value) => transferFootprint({
            projectId,
            request: input,
            authorization: value.authorization,
          }),
          authorization: (value) => ({
            tool: "transfer_blocks",
            preview: transferPreview(input, value.authorization),
          }),
        });
        if (prepared.kind === "completed") return prepared.output;
        const command = prepared.command;
        const result = await withExecutionTimeout(
          async () => await this.documentHub.executeNodexAgentTransfer(
            command,
          ),
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ error: result.error });
        return result.value.output;
      },
      edit_database: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const request = {
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        };
        const prepared = await prepareAuthorizedWrite(context, {
          prepare: async () => {
            const result = (await this.writer.prepareNodexAgentDatabaseEdit(request)).result;
            if (!result.ok) return fail({ error: result.error });
            return result.value;
          },
          footprint: () => databaseFootprint({ projectId, request: input }),
          authorization: () => ({
            tool: "edit_database",
            preview: editDatabasePreview(input),
          }),
        });
        if (prepared.kind === "completed") return prepared.output;
        const command = prepared.command;
        const result = await withExecutionTimeout(
          async () => (await this.writer.executeNodexAgentDatabaseEdit(
            command,
          )).result,
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ error: result.error });
        return result.value.output;
      },
    };
    this.registry = createNodexDynamicToolRegistry(handlers);
  }
}

export const nodexAgentDynamicService = new NodexAgentDynamicService();
