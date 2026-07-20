import type { components } from "@nodex/core-protocol";
import {
  canonicalizeNodexAgentResourceGrantSpecs,
  type NodexAgentAuthorizationTarget,
  type NodexAgentResourceAccessOverlay,
  type NodexAgentResourceAccessPlan,
  type NodexAgentResourceGrantRoot,
  type NodexAgentResourceGrantSpec,
  type NodexAgentResourceIntent,
} from "../../shared/nodex-agent-resource-access";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import type {
  NodexAgentResourceAuthorityPort,
  PlanNodexAgentResourceAccessInput,
} from "../nodex-agent-resource-authority-port";
import type {
  DesktopDataAuthorityRuntime,
  RustDataAuthorityRuntime,
} from "./desktop-data-authority";

type CoreAgentTarget = components["schemas"]["AgentAuthorizationTarget"];
type CoreAgentGrant = components["schemas"]["AgentResourceGrantSpec"];
type CoreAgentOverlay = components["schemas"]["AgentResourceAccessOverlay"];
type CoreAgentPlan = components["schemas"]["AgentResourceAccessPlan"];

export const toCoreAgentTurnProvenance = (
  profileId: string,
  authority: FrozenNodexAgentTurnAuthority,
) => ({
  profile_id: profileId,
  authority: {
    thread_id: authority.threadId,
    turn_id: authority.turnId,
    root_thread_id: authority.rootThreadId,
    actor_project_id: authority.actorProjectId,
    library_id: authority.libraryId,
    store_epoch: authority.storeEpoch,
    scope: authority.scope,
    source: authority.source,
  },
}) as const;

const toCoreTarget = (target: NodexAgentAuthorizationTarget): CoreAgentTarget => {
  switch (target.kind) {
    case "page":
      return { kind: target.kind, page_id: target.pageId };
    case "database":
      return { kind: target.kind, database_id: target.databaseId };
    case "data_source":
      return { kind: target.kind, data_source_id: target.dataSourceId };
    case "view":
      return { kind: target.kind, view_id: target.viewId };
    case "library":
      return { kind: target.kind, library_id: target.libraryId };
    case "page_or_block":
      return { kind: target.kind, id: target.id };
  }
};

const fromCoreTarget = (target: CoreAgentTarget): NodexAgentAuthorizationTarget => {
  switch (target.kind) {
    case "page":
      return { kind: target.kind, pageId: target.page_id };
    case "database":
      return { kind: target.kind, databaseId: target.database_id };
    case "data_source":
      return { kind: target.kind, dataSourceId: target.data_source_id };
    case "view":
      return { kind: target.kind, viewId: target.view_id };
    case "library":
      return { kind: target.kind, libraryId: target.library_id };
    case "page_or_block":
      return { kind: target.kind, id: target.id };
  }
};

const toCoreGrantRoot = (
  root: NodexAgentResourceGrantRoot,
): CoreAgentGrant["root"] => {
  switch (root.kind) {
    case "page":
      return { kind: root.kind, page_id: root.pageId };
    case "database":
      return { kind: root.kind, database_id: root.databaseId };
    case "library":
      return { kind: root.kind, library_id: root.libraryId };
  }
};

const fromCoreGrantRoot = (
  root: CoreAgentGrant["root"],
): NodexAgentResourceGrantRoot => {
  switch (root.kind) {
    case "page":
      return { kind: root.kind, pageId: root.page_id };
    case "database":
      return { kind: root.kind, databaseId: root.database_id };
    case "library":
      return { kind: root.kind, libraryId: root.library_id };
  }
};

const toCoreGrant = (grant: NodexAgentResourceGrantSpec): CoreAgentGrant => ({
  root: toCoreGrantRoot(grant.root),
  access: grant.access,
  ...(grant.libraryActions ? { library_actions: grant.libraryActions } : {}),
});

const fromCoreGrant = (grant: CoreAgentGrant): NodexAgentResourceGrantSpec => {
  const libraryActions = grant.library_actions ?? [];
  if (libraryActions.some((action) => action !== "create_child")) {
    throw new Error("Core returned an unsupported Library grant action");
  }
  return {
    root: fromCoreGrantRoot(grant.root),
    access: grant.access,
    ...(libraryActions.length > 0
      ? { libraryActions: libraryActions as readonly "create_child"[] }
      : {}),
  };
};

const toCoreOverlay = (
  overlay: NodexAgentResourceAccessOverlay,
): CoreAgentOverlay => ({
  kind: overlay.kind,
  scope: overlay.scope,
  ...(overlay.scope === "call"
    ? {
        thread_id: overlay.threadId,
        turn_id: overlay.turnId,
        call_id: overlay.callId,
      }
    : {}),
  root_thread_id: overlay.rootThreadId,
  actor_project_id: overlay.actorProjectId,
  library_id: overlay.libraryId,
  store_epoch: overlay.storeEpoch,
  grants: canonicalizeNodexAgentResourceGrantSpecs(overlay.grants).map(toCoreGrant),
  ...(overlay.persistResultingPageGrants
    ? { persist_resulting_page_grants: true }
    : {}),
});

export const toCoreAgentExecutionAuthorization = (
  profileId: string,
  authority: FrozenNodexAgentTurnAuthority,
  callId: string,
  resourceAccess?: NodexAgentResourceAccessOverlay,
): components["schemas"]["AgentExecutionAuthorization"] => ({
  provenance: toCoreAgentTurnProvenance(profileId, authority),
  call_id: callId,
  ...(resourceAccess ? { resource_access: toCoreOverlay(resourceAccess) } : {}),
});

const fromCoreOverlay = (
  overlay: CoreAgentOverlay,
): NodexAgentResourceAccessOverlay => {
  const base = {
    kind: overlay.kind,
    rootThreadId: overlay.root_thread_id,
    actorProjectId: overlay.actor_project_id,
    libraryId: overlay.library_id,
    storeEpoch: overlay.store_epoch,
    grants: canonicalizeNodexAgentResourceGrantSpecs(
      overlay.grants.map(fromCoreGrant),
    ),
    ...(overlay.persist_resulting_page_grants
      ? { persistResultingPageGrants: true }
      : {}),
  } as const;
  if (overlay.scope === "task") {
    if (overlay.kind !== "consent") {
      throw new Error("Core returned task-scoped inspection access");
    }
    return { ...base, kind: "consent", scope: "task" };
  }
  if (!overlay.thread_id || !overlay.turn_id || !overlay.call_id) {
    throw new Error("Core returned call access without exact coordinates");
  }
  return {
    ...base,
    scope: "call",
    threadId: overlay.thread_id,
    turnId: overlay.turn_id,
    callId: overlay.call_id,
  };
};

const toCoreIntent = (intent: NodexAgentResourceIntent) => ({
  target: toCoreTarget(intent.target),
  action: intent.action,
});

const fromCoreIntent = (
  intent: components["schemas"]["AgentResourceIntent"],
): NodexAgentResourceIntent => ({
  target: fromCoreTarget(intent.target),
  action: intent.action,
});

const fromCorePlan = (plan: CoreAgentPlan): NodexAgentResourceAccessPlan => {
  switch (plan.kind) {
    case "authorized":
      return {
        kind: plan.kind,
        ...(plan.resource_access
          ? { resourceAccess: fromCoreOverlay(plan.resource_access) }
          : {}),
      };
    case "consent_required":
      return {
        kind: plan.kind,
        requirements: plan.requirements.map((requirement) => ({
          intent: fromCoreIntent(requirement.intent),
          grant: fromCoreGrant(requirement.grant),
          reason: requirement.reason,
          persistable: requirement.persistable,
        })),
        inspectionAccess: fromCoreOverlay(plan.inspection_access),
      };
    case "denied":
      return {
        kind: plan.kind,
        intent: fromCoreIntent(plan.intent),
        reason: plan.reason,
      };
  }
};

const assertOverlayBoundary = (
  authority: FrozenNodexAgentTurnAuthority,
  callId: string,
  overlay: NodexAgentResourceAccessOverlay,
): void => {
  if (
    overlay.rootThreadId !== authority.rootThreadId
    || overlay.actorProjectId !== authority.actorProjectId
    || overlay.libraryId !== authority.libraryId
    || overlay.storeEpoch !== authority.storeEpoch
  ) {
    throw new Error("Core Agent resource access escaped its Turn authority");
  }
  if (
    overlay.scope === "call"
    && (
      overlay.threadId !== authority.threadId
      || overlay.turnId !== authority.turnId
      || overlay.callId !== callId
    )
  ) {
    throw new Error("Core Agent call access escaped its exact call coordinates");
  }
};

const assertPlanBoundary = (
  authority: FrozenNodexAgentTurnAuthority,
  callId: string,
  plan: NodexAgentResourceAccessPlan,
): void => {
  if (plan.kind === "authorized" && plan.resourceAccess) {
    assertOverlayBoundary(authority, callId, plan.resourceAccess);
    return;
  }
  if (plan.kind === "consent_required") {
    if (
      plan.inspectionAccess.kind !== "inspection"
      || plan.inspectionAccess.scope !== "call"
    ) {
      throw new Error("Core consent plan omitted exact inspection access");
    }
    assertOverlayBoundary(authority, callId, plan.inspectionAccess);
  }
};

const createCorePort = (
  runtime: RustDataAuthorityRuntime,
): NodexAgentResourceAuthorityPort => {
  const plan = async (
    input: PlanNodexAgentResourceAccessInput,
  ): Promise<NodexAgentResourceAccessPlan> => {
    const snapshot = await runtime.clientForProject(input.authority.actorProjectId)
      .libraryRead({
        kind: "plan_agent_resource_access",
        provenance: toCoreAgentTurnProvenance(
          runtime.rootClient.handshake.profile_id,
          input.authority,
        ),
        call_id: input.callId,
        intents: input.intents.map(toCoreIntent),
        task_access: input.taskAccess ? toCoreOverlay(input.taskAccess) : null,
      });
    if (snapshot.value.kind !== "agent_resource_access_plan") {
      throw new Error("Core returned the wrong Agent resource plan variant");
    }
    if (snapshot.store_epoch !== input.authority.storeEpoch) {
      throw new Error("Core Agent resource plan escaped its Store boundary");
    }
    const plan = fromCorePlan(snapshot.value.value);
    assertPlanBoundary(input.authority, input.callId, plan);
    return plan;
  };

  return {
    plan,
    persistProjectGrants: async (input) => {
      const committed = await runtime.clientForProject(
        input.authority.actorProjectId,
      ).libraryApply({
        operationId: input.operationId,
        intent: {
          kind: "persist_agent_project_resource_grants",
          provenance: toCoreAgentTurnProvenance(
            runtime.rootClient.handshake.profile_id,
            input.authority,
          ),
          grants: canonicalizeNodexAgentResourceGrantSpecs(input.grants)
            .map(toCoreGrant),
        },
      });
      if (
        committed.store_epoch !== input.authority.storeEpoch
        || committed.receipt.operation_id !== input.operationId
        || committed.receipt.operation_kind
          !== "persist_agent_project_resource_grants"
      ) {
        throw new Error("Core Agent Project grants escaped their receipt boundary");
      }
    },
  };
};

export interface DesktopNodexAgentResourceAuthorityPortInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly typescript: NodexAgentResourceAuthorityPort;
}

export const createDesktopNodexAgentResourceAuthorityPort = (
  input: DesktopNodexAgentResourceAuthorityPortInput,
): NodexAgentResourceAuthorityPort => {
  let selected: NodexAgentResourceAuthorityPort | null = null;
  const resolve = async (): Promise<NodexAgentResourceAuthorityPort> => {
    if (selected) return selected;
    const runtime = await input.authority;
    selected = runtime.backend === "typescript"
      ? input.typescript
      : createCorePort(runtime);
    return selected;
  };
  return {
    plan: async (request) => await (await resolve()).plan(request),
    persistProjectGrants: async (request) =>
      await (await resolve()).persistProjectGrants(request),
  };
};
