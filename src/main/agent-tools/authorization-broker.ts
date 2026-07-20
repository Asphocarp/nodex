import { createHash, randomUUID } from "node:crypto";
import {
  NODEX_AGENT_AUTHORIZATION_RENDERER_METHOD,
  NODEX_AGENT_AUTHORIZATION_TIMEOUT_MS,
  type NodexAgentAuthorizationRequest,
  type NodexAgentAuthorizationResponse,
} from "../../shared/nodex-agent-tools";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import {
  canonicalizeNodexAgentResourceGrantSpecs,
  type NodexAgentResourceAccessOverlay,
  type NodexAgentResourceGrantSpec,
  type PersistNodexAgentProjectResourceGrantsInput,
} from "../../shared/nodex-agent-resource-access";
import type { RendererClientRouter } from "../codex/renderer-client-router";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { getDb } from "../local-store/database";
import type { NodexAgentDynamicAuthorizationInput } from "./dynamic-service-core";

export type NodexAgentAuthorizationOutcome =
  | {
      readonly decision: "allow_once" | "allow_task" | "allow_project";
      readonly resourceAccess?: NodexAgentResourceAccessOverlay;
    }
  | "deny"
  | "unavailable";

interface NodexAgentAuthorizationGrant {
  readonly key: string;
  readonly rootThreadId: string;
  readonly projectId: string;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly grants: readonly NodexAgentResourceGrantSpec[];
}

export interface NodexAgentAuthorizationBrokerOptions {
  readonly rendererClientRouter: Pick<RendererClientRouter, "sendRequest">;
  readonly sessionEpoch?: string;
  readonly now?: () => number;
  readonly readStoreEpoch?: () => string | null;
  readonly persistProjectGrants?: (
    input: PersistNodexAgentProjectResourceGrantsInput,
  ) => Promise<unknown>;
}

export interface NodexAgentAuthorizationPresentationTarget {
  readonly clientId: string;
  readonly threadId: string;
  readonly turnId: string;
}

export interface AuthorizeNodexAgentAccessInput
  extends NodexAgentDynamicAuthorizationInput {
  readonly rootThreadId: string;
  readonly authority: FrozenNodexAgentTurnAuthority;
  readonly presentation: NodexAgentAuthorizationPresentationTarget | null;
  /** Main-owned exact-Turn check, evaluated after the renderer responds. */
  readonly isAuthorityCurrent?: () => boolean | Promise<boolean>;
}

/** @deprecated Use the resource-scoped access input. */
export type AuthorizeNodexAgentWriteInput = AuthorizeNodexAgentAccessInput;

function parseResponse(value: unknown): NodexAgentAuthorizationResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const decision = (value as { readonly decision?: unknown }).decision;
  if (
    decision !== "allow_once"
    && decision !== "allow_task"
    && decision !== "allow_project"
    && decision !== "deny"
  ) return null;
  return { decision };
}

export class NodexAgentAuthorizationBroker {
  private readonly router: Pick<RendererClientRouter, "sendRequest">;
  private readonly sessionEpoch: string;
  private readonly now: () => number;
  private readonly readStoreEpoch: () => string | null;
  private readonly persistProjectGrants: NodexAgentAuthorizationBrokerOptions[
    "persistProjectGrants"
  ];
  private readonly grants = new Map<string, NodexAgentAuthorizationGrant>();

  constructor(options: NodexAgentAuthorizationBrokerOptions) {
    this.router = options.rendererClientRouter;
    this.sessionEpoch = options.sessionEpoch ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.readStoreEpoch = options.readStoreEpoch
      ?? (() => readBlockStoreEpoch(getDb()));
    this.persistProjectGrants = options.persistProjectGrants;
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

  getTaskAccess(
    authority: FrozenNodexAgentTurnAuthority,
  ): NodexAgentResourceAccessOverlay | undefined {
    if (authority.scope !== "project") return undefined;
    const storeEpoch = this.readStoreEpoch();
    if (!storeEpoch || storeEpoch !== authority.storeEpoch) {
      this.revokeAll();
      return undefined;
    }
    this.revokeStaleRootGrants(
      authority.rootThreadId,
      authority.actorProjectId,
      storeEpoch,
    );
    const grant = this.grants.get(this.grantKey({
      rootThreadId: authority.rootThreadId,
      projectId: authority.actorProjectId,
      storeEpoch,
    }));
    if (!grant || grant.libraryId !== authority.libraryId) return undefined;
    return this.taskOverlay(authority, grant.grants);
  }

  extendTaskAccess(
    authority: FrozenNodexAgentTurnAuthority,
    grants: readonly NodexAgentResourceGrantSpec[],
  ): void {
    const existingAccess = this.getTaskAccess(authority);
    if (!existingAccess) return;
    const storeEpoch = authority.storeEpoch;
    const key = this.grantKey({
      rootThreadId: authority.rootThreadId,
      projectId: authority.actorProjectId,
      storeEpoch,
    });
    const existing = this.grants.get(key);
    if (!existing) return;
    this.grants.set(key, {
      ...existing,
      grants: canonicalizeNodexAgentResourceGrantSpecs([
        ...existing.grants,
        ...grants,
      ]),
    });
  }

  async authorize(
    input: AuthorizeNodexAgentAccessInput,
  ): Promise<NodexAgentAuthorizationOutcome> {
    const storeEpoch = this.readStoreEpoch();
    if (
      !storeEpoch
      || storeEpoch !== input.authority.storeEpoch
      || input.authority.scope !== "project"
      || input.rootThreadId !== input.authority.rootThreadId
      || input.projectId !== input.authority.actorProjectId
    ) {
      if (!storeEpoch) this.revokeAll();
      return "unavailable";
    }
    this.revokeStaleRootGrants(input.rootThreadId, input.projectId, storeEpoch);
    if (!input.presentation) return "unavailable";

    const request: NodexAgentAuthorizationRequest = {
      type: "nodexAgentAuthorization",
      requestId: `nodex-authorization:${randomUUID()}`,
      projectId: input.projectId,
      threadId: input.presentation.threadId,
      turnId: input.presentation.turnId,
      itemId: input.callId,
      tool: input.tool,
      effect: input.effect,
      preview: input.preview,
      createdAt: this.now(),
    };
    let rawResponse: unknown;
    try {
      rawResponse = await this.router.sendRequest(
        input.presentation.clientId,
        NODEX_AGENT_AUTHORIZATION_RENDERER_METHOD,
        request,
        { timeoutMs: NODEX_AGENT_AUTHORIZATION_TIMEOUT_MS },
      );
    } catch {
      return "unavailable";
    }
    const response = parseResponse(rawResponse);
    if (!response) return "unavailable";
    if (response.decision === "deny") return "deny";
    if (
      this.readStoreEpoch() !== storeEpoch
      || (input.isAuthorityCurrent
        && !(await input.isAuthorityCurrent()))
    ) return "unavailable";

    if (response.decision === "allow_once") {
      return {
        decision: "allow_once",
        resourceAccess: this.callOverlay(
          input.authority,
          input.callId,
          input.inspectionAccess.grants,
        ),
      };
    }

    if (response.decision === "allow_task") {
      const key = this.grantKey({
        rootThreadId: input.rootThreadId,
        projectId: input.projectId,
        storeEpoch,
      });
      const existing = this.grants.get(key);
      const grants = canonicalizeNodexAgentResourceGrantSpecs([
        ...(existing?.grants ?? []),
        ...input.requirements.map((requirement) => requirement.grant),
      ]);
      this.grants.set(key, {
        key,
        rootThreadId: input.rootThreadId,
        projectId: input.projectId,
        libraryId: input.authority.libraryId,
        storeEpoch,
        grants,
      });
      return {
        decision: "allow_task",
        resourceAccess: this.taskOverlay(input.authority, grants),
      };
    }

    const persistable = input.requirements
      .filter((requirement) => requirement.persistable)
      .map((requirement) => requirement.grant);
    if (persistable.length > 0) {
      if (!this.persistProjectGrants) return "unavailable";
      try {
        await this.persistProjectGrants({
          operationId: `nodex-agent-grants:${createHash("sha256")
            .update(JSON.stringify([
              input.authority.threadId,
              input.authority.turnId,
              input.callId,
            ]))
            .digest("hex")}`,
          authority: input.authority,
          grants: persistable,
        });
      } catch {
        return "unavailable";
      }
    }
    if (
      this.readStoreEpoch() !== storeEpoch
      || (input.isAuthorityCurrent
        && !(await input.isAuthorityCurrent()))
    ) return "unavailable";

    const taskAccess = this.getTaskAccess(input.authority);
    const nonPersistable = input.requirements
      .filter((requirement) => !requirement.persistable)
      .map((requirement) => requirement.grant);
    if (nonPersistable.length === 0) {
      return {
        decision: "allow_project",
        ...(taskAccess ? { resourceAccess: taskAccess } : {}),
      };
    }
    return {
      decision: "allow_project",
      resourceAccess: this.callOverlay(
        input.authority,
        input.callId,
        [...(taskAccess?.grants ?? []), ...nonPersistable],
        true,
      ),
    };
  }

  revokeRoot(rootThreadId: string): void {
    for (const [key, grant] of this.grants) {
      if (grant.rootThreadId === rootThreadId) this.grants.delete(key);
    }
  }

  /** Task grants belong to the task, not to whichever renderer presented it. */
  revokePresentationClient(_presentationClientId: string): void {
    void _presentationClientId;
  }

  revokeAll(): void {
    this.grants.clear();
  }

  private callOverlay(
    authority: FrozenNodexAgentTurnAuthority,
    callId: string,
    grants: readonly NodexAgentResourceGrantSpec[],
    persistResultingPageGrants = false,
  ): NodexAgentResourceAccessOverlay {
    return {
      kind: "consent",
      scope: "call",
      threadId: authority.threadId,
      turnId: authority.turnId,
      callId,
      rootThreadId: authority.rootThreadId,
      actorProjectId: authority.actorProjectId,
      libraryId: authority.libraryId,
      storeEpoch: authority.storeEpoch,
      grants: canonicalizeNodexAgentResourceGrantSpecs(grants),
      ...(persistResultingPageGrants ? { persistResultingPageGrants: true } : {}),
    };
  }

  private taskOverlay(
    authority: FrozenNodexAgentTurnAuthority,
    grants: readonly NodexAgentResourceGrantSpec[],
  ): NodexAgentResourceAccessOverlay {
    return {
      kind: "consent",
      scope: "task",
      rootThreadId: authority.rootThreadId,
      actorProjectId: authority.actorProjectId,
      libraryId: authority.libraryId,
      storeEpoch: authority.storeEpoch,
      grants: canonicalizeNodexAgentResourceGrantSpecs(grants),
    };
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
