import { randomUUID } from "node:crypto";
import {
  NODEX_AGENT_AUTHORIZATION_RENDERER_METHOD,
  NODEX_AGENT_AUTHORIZATION_TIMEOUT_MS,
  type NodexAgentAuthorizationDecision,
  type NodexAgentAuthorizationRequest,
  type NodexAgentAuthorizationResponse,
} from "../../shared/nodex-agent-tools";
import type { RendererClientRouter } from "../codex/renderer-client-router";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { getDb } from "../local-store/database";
import type { NodexAgentDynamicAuthorizationInput } from "./dynamic-service-core";

export type NodexAgentAuthorizationOutcome =
  | NodexAgentAuthorizationDecision
  | "unavailable";

interface NodexAgentAuthorizationGrant {
  readonly key: string;
  readonly rootThreadId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly ownerClientId: string;
}

export interface NodexAgentAuthorizationBrokerOptions {
  readonly rendererClientRouter: Pick<RendererClientRouter, "sendRequest">;
  readonly sessionEpoch?: string;
  readonly now?: () => number;
  readonly readStoreEpoch?: () => string | null;
}

export interface AuthorizeNodexAgentWriteInput
  extends NodexAgentDynamicAuthorizationInput {
  readonly rootThreadId: string;
  readonly ownerClientId: string | null;
  readonly presentationThreadId: string;
  readonly presentationTurnId: string;
}

function parseResponse(value: unknown): NodexAgentAuthorizationResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const decision = (value as { readonly decision?: unknown }).decision;
  if (
    decision !== "allow_once"
    && decision !== "allow_task"
    && decision !== "deny"
  ) {
    return null;
  }
  return { decision };
}

export class NodexAgentAuthorizationBroker {
  private readonly router: Pick<RendererClientRouter, "sendRequest">;
  private readonly sessionEpoch: string;
  private readonly now: () => number;
  private readonly readStoreEpoch: () => string | null;
  private readonly grants = new Map<string, NodexAgentAuthorizationGrant>();

  constructor(options: NodexAgentAuthorizationBrokerOptions) {
    this.router = options.rendererClientRouter;
    this.sessionEpoch = options.sessionEpoch ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.readStoreEpoch = options.readStoreEpoch
      ?? (() => readBlockStoreEpoch(getDb()));
  }

  hasGrant(input: {
    readonly rootThreadId: string;
    readonly projectId: string;
  }): boolean {
    const storeEpoch = this.readStoreEpoch();
    if (!storeEpoch) {
      this.revokeAll();
      return false;
    }
    this.revokeStaleRootGrants(input.rootThreadId, input.projectId, storeEpoch);
    return this.grants.has(this.grantKey({ ...input, storeEpoch }));
  }

  async authorize(
    input: AuthorizeNodexAgentWriteInput,
  ): Promise<NodexAgentAuthorizationOutcome> {
    const storeEpoch = this.readStoreEpoch();
    if (!storeEpoch) {
      this.revokeAll();
      return "unavailable";
    }
    this.revokeStaleRootGrants(input.rootThreadId, input.projectId, storeEpoch);
    if (!input.ownerClientId) return "unavailable";
    const key = this.grantKey({
      rootThreadId: input.rootThreadId,
      projectId: input.projectId,
      storeEpoch,
    });
    if (input.effect === "write" && this.grants.has(key)) return "allow_task";

    const authorizationId = `nodex-authorization:${randomUUID()}`;
    const request: NodexAgentAuthorizationRequest = {
      type: "nodexAgentAuthorization",
      requestId: authorizationId,
      projectId: input.projectId,
      threadId: input.presentationThreadId,
      turnId: input.presentationTurnId,
      itemId: input.callId,
      tool: input.tool,
      effect: input.effect,
      preview: input.preview,
      createdAt: this.now(),
    };
    let rawResponse: unknown;
    try {
      rawResponse = await this.router.sendRequest(
        input.ownerClientId,
        NODEX_AGENT_AUTHORIZATION_RENDERER_METHOD,
        request,
        { timeoutMs: NODEX_AGENT_AUTHORIZATION_TIMEOUT_MS },
      );
    } catch {
      return "unavailable";
    }
    const response = parseResponse(rawResponse);
    if (!response) return "unavailable";
    if (this.readStoreEpoch() !== storeEpoch) return "unavailable";
    if (response.decision !== "allow_task" || input.effect === "destructive") {
      return response.decision === "allow_task" ? "allow_once" : response.decision;
    }
    this.grants.set(key, {
      key,
      rootThreadId: input.rootThreadId,
      projectId: input.projectId,
      storeEpoch,
      ownerClientId: input.ownerClientId,
    });
    return "allow_task";
  }

  revokeRoot(rootThreadId: string): void {
    for (const [key, grant] of this.grants) {
      if (grant.rootThreadId === rootThreadId) this.grants.delete(key);
    }
  }

  revokeOwner(ownerClientId: string): void {
    for (const [key, grant] of this.grants) {
      if (grant.ownerClientId === ownerClientId) this.grants.delete(key);
    }
  }

  revokeAll(): void {
    this.grants.clear();
  }

  private revokeStaleRootGrants(
    rootThreadId: string,
    projectId: string,
    storeEpoch: string,
  ): void {
    for (const [key, grant] of this.grants) {
      if (grant.storeEpoch !== storeEpoch) {
        this.grants.delete(key);
        continue;
      }
      if (grant.rootThreadId === rootThreadId && grant.projectId !== projectId) {
        this.grants.delete(key);
      }
    }
  }

  private grantKey(input: {
    readonly rootThreadId: string;
    readonly projectId: string;
    readonly storeEpoch: string;
  }): string {
    return JSON.stringify([
      this.sessionEpoch,
      input.rootThreadId,
      input.projectId,
      input.storeEpoch,
    ]);
  }
}
