import {
  NODEX_AGENT_TOOL_SCHEMA_VERSION,
  type CreateInput,
  type EditDatabaseInput,
  type EditDocumentInput,
  type NodexAgentAccess,
  type NodexAgentAuthorizationDecision,
  type NodexAgentAuthorizationPreview,
  type NodexAgentToolName,
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

const NODEX_AGENT_EXECUTION_TIMEOUT_MS = 30_000;
const MAX_AUTHORIZATION_NFM_PREVIEW_CHARS = 1_600;

type NodexAgentWriteTool = Extract<
  NodexAgentToolName,
  "create" | "edit_document" | "transfer_blocks" | "edit_database"
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

function toolFailure(
  code: ToolFailure["error"]["code"],
  message: string,
  recovery: ToolFailure["error"]["recovery"],
  retryable = false,
): ToolFailure {
  return {
    schemaVersion: NODEX_AGENT_TOOL_SCHEMA_VERSION,
    error: { code, message, retryable, recovery },
  };
}

export class NodexAgentDynamicToolFailure extends Error {
  constructor(readonly failure: ToolFailure) {
    super(failure.error.message);
    this.name = "NodexAgentDynamicToolFailure";
  }
}

function fail(failure: ToolFailure): never {
  throw new NodexAgentDynamicToolFailure(failure);
}

function projectRequired(context: NodexAgentDynamicExecutionContext): string {
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

function transferPreview(input: TransferBlocksInput): NodexAgentAuthorizationPreview {
  const verb = input.mode === "copy" ? "Copy" : "Move";
  return {
    title: `${verb} ${input.items.length} Nodex Block${input.items.length === 1 ? "" : "s"}`,
    summary: `${verb} the selected root Block${input.items.length === 1 ? "" : "s"} and their owned content.`,
    details: [
      { label: "Destination", value: destinationLabel(input.destination) },
      { label: "Roots", value: input.items.map((item) => item.blockId).join(", ") },
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

async function withExecutionTimeout<T>(
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
        if (!result.ok) return fail({ schemaVersion: 1, error: result.error });
        if (result.tool !== "get_context") throw new Error("Nodex read tool mismatch");
        return result.output;
      },
      get_block: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentTool({
          tool: "get_block",
          projectId: projectRequired(context),
          input,
        })).result;
        if (!result.ok) return fail({ schemaVersion: 1, error: result.error });
        if (result.tool !== "get_block") throw new Error("Nodex read tool mismatch");
        return result.output;
      },
      search: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentTool({
          tool: "search",
          projectId: projectRequired(context),
          input,
        })).result;
        if (!result.ok) return fail({ schemaVersion: 1, error: result.error });
        if (result.tool !== "search") throw new Error("Nodex read tool mismatch");
        return result.output;
      },
      query_database: async ({ input, context }) => {
        const result = (await this.writer.readNodexAgentTool({
          tool: "query_database",
          projectId: projectRequired(context),
          input,
        })).result;
        if (!result.ok) return fail({ schemaVersion: 1, error: result.error });
        if (result.tool !== "query_database") throw new Error("Nodex read tool mismatch");
        return result.output;
      },
      create: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const prepared = (await this.writer.prepareNodexAgentCreate({
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        })).result;
        if (!prepared.ok) return fail({ schemaVersion: 1, error: prepared.error });
        if (prepared.value.kind === "completed") return prepared.value.output;
        await requireAuthorization(context, {
          tool: "create",
          effect: "write",
          preview: createPreview(
            input,
            prepared.value.createdBodyBlockIds.length,
            prepared.value.targetNfm,
          ),
        });
        const command = prepared.value.command;
        const leaseDocuments = prepared.value.leaseDocuments;
        const result = await withExecutionTimeout(
          async () => await this.documentHub.executeNodexAgentCreate(
            command,
            leaseDocuments,
          ),
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ schemaVersion: 1, error: result.error });
        return result.value.output;
      },
      edit_document: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const prepared = (await this.writer.prepareNodexAgentDocumentEdit({
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        })).result;
        if (!prepared.ok) return fail({ schemaVersion: 1, error: prepared.error });
        if (prepared.value.kind === "completed") return prepared.value.output;
        const destructive = prepared.value.effects.deletedBlockIds.length > 0
          || input.body?.kind === "nfm.replace";
        await requireAuthorization(context, {
          tool: "edit_document",
          effect: destructive ? "destructive" : "write",
          preview: editDocumentPreview(
            input,
            prepared.value.effects,
            prepared.value.targetNfm,
          ),
        });
        const mutation = prepared.value.mutation;
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
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          result: mutationResult.value,
        })).result;
        if (!completed.ok) return fail({ schemaVersion: 1, error: completed.error });
        return completed.output;
      },
      transfer_blocks: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const prepared = (await this.writer.prepareNodexAgentTransfer({
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        })).result;
        if (!prepared.ok) return fail({ schemaVersion: 1, error: prepared.error });
        if (prepared.value.kind === "completed") return prepared.value.output;
        await requireAuthorization(context, {
          tool: "transfer_blocks",
          effect: "write",
          preview: transferPreview(input),
        });
        const command = prepared.value.command;
        const result = await withExecutionTimeout(
          async () => await this.documentHub.executeNodexAgentTransfer(
            command,
          ),
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ schemaVersion: 1, error: result.error });
        return result.value.output;
      },
      edit_database: async ({ input, context }) => {
        const projectId = projectRequired(context);
        const prepared = (await this.writer.prepareNodexAgentDatabaseEdit({
          threadId: context.threadId,
          callId: context.callId,
          projectId,
          input,
        })).result;
        if (!prepared.ok) return fail({ schemaVersion: 1, error: prepared.error });
        if (prepared.value.kind === "completed") return prepared.value.output;
        await requireAuthorization(context, {
          tool: "edit_database",
          effect: "write",
          preview: editDatabasePreview(input),
        });
        const command = prepared.value.command;
        const result = await withExecutionTimeout(
          async () => (await this.writer.executeNodexAgentDatabaseEdit(
            command,
          )).result,
          this.executionTimeoutMs,
        );
        if (!result.ok) return fail({ schemaVersion: 1, error: result.error });
        return result.value.output;
      },
    };
    this.registry = createNodexDynamicToolRegistry(handlers);
  }
}

export const nodexAgentDynamicService = new NodexAgentDynamicService();
