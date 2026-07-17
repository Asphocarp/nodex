import type {
  NodexAgentAccess,
  NodexAgentAuthorizationDecision,
  NodexAgentAuthorizationPreview,
  NodexAgentV3ToolName,
  ToolFailure,
} from "../../shared/nodex-agent-tools";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import type { DynamicToolEffect } from "../codex/dynamic-tool-registry";
import {
  sameAuthorizationFootprint,
  type NodexAgentAuthorizationFootprint,
} from "./authorization-footprint";

export type NodexAgentWriteTool = Extract<
  NodexAgentV3ToolName,
  | "create_pages"
  | "update_page"
  | "advanced_update_page"
  | "move_pages"
  | "duplicate_page"
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
  readonly authority: FrozenNodexAgentTurnAuthority | null;
  readonly access: NodexAgentAccess;
  readonly authorize: (
    input: NodexAgentDynamicAuthorizationInput,
  ) => Promise<NodexAgentAuthorizationDecision | "unavailable">;
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

export function projectRequired(
  context: NodexAgentDynamicExecutionContext,
): string {
  if (context.authority) return context.authority.actorProjectId;
  return fail(toolFailure(
    "project_context_required",
    "This Nodex tool requires a task bound to a Project",
    "start_new_task",
  ));
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
  input: Omit<
    NodexAgentDynamicAuthorizationInput,
    "threadId" | "callId" | "projectId"
  >,
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
        timeout = setTimeout(() => reject(new NodexAgentDynamicToolFailure(
          toolFailure(
            "timeout",
            "The Nodex write did not finish within its execution window; retry the same call identity",
            "retry_same",
            true,
          ),
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
