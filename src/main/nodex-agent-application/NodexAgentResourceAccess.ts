import type { components } from "@nodex/core-protocol";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import {
  canonicalizeNodexAgentResourceGrantSpecs,
  type NodexAgentAuthorizationTarget,
  type NodexAgentResourceAccessOverlay,
  type NodexAgentResourceAccessPlan,
  type NodexAgentResourceGrantRoot,
  type NodexAgentResourceGrantSpec,
  type NodexAgentResourceIntent,
  type PersistNodexAgentProjectResourceGrantsInput,
} from "../../shared/nodex-agent-resource-access";
import { toCoreAgentTurnProvenance } from "../core-client/core-agent-execution-authorization";
import { applyResultStoreEpoch } from "../core-client/types";
import { CoreAuthority } from "../core-runtime/CoreAuthority";
import { CoreModules } from "../core-runtime/CoreModules";

type CoreTarget = components["schemas"]["AgentAuthorizationTarget"];
type CoreGrant = components["schemas"]["AgentResourceGrantSpec"];
type CoreOverlay = components["schemas"]["AgentResourceAccessOverlay"];
type CorePlan = components["schemas"]["AgentResourceAccessPlan"];

export class NodexAgentResourceAccessError extends Schema.TaggedError<NodexAgentResourceAccessError>()(
  "NodexAgentResourceAccessError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class NodexAgentResourceAccess extends Context.Service<
  NodexAgentResourceAccess,
  {
    readonly plan: (input: {
      readonly authority: FrozenNodexAgentTurnAuthority;
      readonly callId: string;
      readonly intents: readonly NodexAgentResourceIntent[];
      readonly taskAccess?: NodexAgentResourceAccessOverlay;
    }) => Effect.Effect<NodexAgentResourceAccessPlan, NodexAgentResourceAccessError>;
    readonly persistProjectGrants: (
      input: PersistNodexAgentProjectResourceGrantsInput,
    ) => Effect.Effect<void, NodexAgentResourceAccessError>;
  }
>()("nodex/main/nodex-agent-application/NodexAgentResourceAccess") {}

const toTarget = (target: NodexAgentAuthorizationTarget): CoreTarget => {
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

const fromTarget = (target: CoreTarget): NodexAgentAuthorizationTarget => {
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

const toRoot = (root: NodexAgentResourceGrantRoot): CoreGrant["root"] => {
  switch (root.kind) {
    case "page":
      return { kind: root.kind, page_id: root.pageId };
    case "database":
      return { kind: root.kind, database_id: root.databaseId };
    case "library":
      return { kind: root.kind, library_id: root.libraryId };
  }
};

const fromRoot = (root: CoreGrant["root"]): NodexAgentResourceGrantRoot => {
  switch (root.kind) {
    case "page":
      return { kind: root.kind, pageId: root.page_id };
    case "database":
      return { kind: root.kind, databaseId: root.database_id };
    case "library":
      return { kind: root.kind, libraryId: root.library_id };
  }
};

const toGrant = (grant: NodexAgentResourceGrantSpec): CoreGrant => ({
  root: toRoot(grant.root),
  access: grant.access,
  ...(grant.libraryActions ? { library_actions: grant.libraryActions } : {}),
});

const fromGrant = (grant: CoreGrant): NodexAgentResourceGrantSpec => {
  const libraryActions = grant.library_actions ?? [];
  if (libraryActions.some((action) => action !== "create_child")) {
    throw new Error("Core returned an unsupported Library grant action");
  }
  return {
    root: fromRoot(grant.root),
    access: grant.access,
    ...(libraryActions.length > 0
      ? { libraryActions: libraryActions as readonly "create_child"[] }
      : {}),
  };
};

const toOverlay = (overlay: NodexAgentResourceAccessOverlay): CoreOverlay => ({
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
  grants: canonicalizeNodexAgentResourceGrantSpecs(overlay.grants).map(toGrant),
  ...(overlay.persistResultingPageGrants ? { persist_resulting_page_grants: true } : {}),
});

const fromOverlay = (overlay: CoreOverlay): NodexAgentResourceAccessOverlay => {
  const base = {
    kind: overlay.kind,
    rootThreadId: overlay.root_thread_id,
    actorProjectId: overlay.actor_project_id,
    libraryId: overlay.library_id,
    storeEpoch: overlay.store_epoch,
    grants: canonicalizeNodexAgentResourceGrantSpecs(overlay.grants.map(fromGrant)),
    ...(overlay.persist_resulting_page_grants ? { persistResultingPageGrants: true } : {}),
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

const fromPlan = (plan: CorePlan): NodexAgentResourceAccessPlan => {
  switch (plan.kind) {
    case "authorized":
      return {
        kind: plan.kind,
        ...(plan.resource_access ? { resourceAccess: fromOverlay(plan.resource_access) } : {}),
      };
    case "consent_required":
      return {
        kind: plan.kind,
        requirements: plan.requirements.map((requirement) => ({
          intent: {
            target: fromTarget(requirement.intent.target),
            action: requirement.intent.action,
          },
          grant: fromGrant(requirement.grant),
          reason: requirement.reason,
          persistable: requirement.persistable,
        })),
        inspectionAccess: fromOverlay(plan.inspection_access),
      };
    case "denied":
      return {
        kind: plan.kind,
        intent: { target: fromTarget(plan.intent.target), action: plan.intent.action },
        reason: plan.reason,
      };
  }
};

const assertOverlay = (
  authority: FrozenNodexAgentTurnAuthority,
  callId: string,
  overlay: NodexAgentResourceAccessOverlay,
): void => {
  if (
    overlay.rootThreadId !== authority.rootThreadId ||
    overlay.actorProjectId !== authority.actorProjectId ||
    overlay.libraryId !== authority.libraryId ||
    overlay.storeEpoch !== authority.storeEpoch
  ) {
    throw new Error("Core Agent resource access escaped its Turn authority");
  }
  if (
    overlay.scope === "call" &&
    (overlay.threadId !== authority.threadId ||
      overlay.turnId !== authority.turnId ||
      overlay.callId !== callId)
  ) {
    throw new Error("Core Agent call access escaped its exact call coordinates");
  }
};

const decodePlan = (
  authority: FrozenNodexAgentTurnAuthority,
  callId: string,
  plan: CorePlan,
): NodexAgentResourceAccessPlan => {
  const decoded = fromPlan(plan);
  if (decoded.kind === "authorized" && decoded.resourceAccess) {
    assertOverlay(authority, callId, decoded.resourceAccess);
  }
  if (decoded.kind === "consent_required") {
    if (
      decoded.inspectionAccess.kind !== "inspection" ||
      decoded.inspectionAccess.scope !== "call"
    ) {
      throw new Error("Core consent plan omitted exact inspection access");
    }
    assertOverlay(authority, callId, decoded.inspectionAccess);
  }
  return decoded;
};

/** Core-backed resource planning, including exact Turn/Call/Store boundary verification. */
export const live: Layer.Layer<NodexAgentResourceAccess, never, CoreAuthority | CoreModules> =
  Layer.effect(
    NodexAgentResourceAccess,
    Effect.gen(function* () {
      const authority = yield* CoreAuthority;
      const core = yield* CoreModules;
      return NodexAgentResourceAccess.of({
        plan: (input) =>
          core.library
            .read(
              {
                kind: "plan_agent_resource_access",
                provenance: toCoreAgentTurnProvenance(
                  authority.identity.profileId,
                  input.authority,
                ),
                call_id: input.callId,
                intents: input.intents.map((intent) => ({
                  target: toTarget(intent.target),
                  action: intent.action,
                })),
                task_access: input.taskAccess ? toOverlay(input.taskAccess) : null,
              },
              undefined,
              input.authority.actorProjectId,
            )
            .pipe(
              Effect.flatMap((snapshot) =>
                Effect.try({
                  try: () => {
                    if (snapshot.value.kind !== "agent_resource_access_plan") {
                      throw new Error("Core returned the wrong Agent resource plan variant");
                    }
                    if (snapshot.store_epoch !== input.authority.storeEpoch) {
                      throw new Error("Core Agent resource plan escaped its Store boundary");
                    }
                    return decodePlan(input.authority, input.callId, snapshot.value.value);
                  },
                  catch: (cause) => new NodexAgentResourceAccessError({ operation: "plan", cause }),
                }),
              ),
              Effect.mapError((cause) =>
                cause instanceof NodexAgentResourceAccessError
                  ? cause
                  : new NodexAgentResourceAccessError({ operation: "plan", cause }),
              ),
            ),
        persistProjectGrants: (input) =>
          core.library
            .apply(
              {
                operationId: input.operationId,
                intent: {
                  kind: "persist_agent_project_resource_grants",
                  provenance: toCoreAgentTurnProvenance(
                    authority.identity.profileId,
                    input.authority,
                  ),
                  grants: canonicalizeNodexAgentResourceGrantSpecs(input.grants).map(toGrant),
                },
              },
              input.authority.actorProjectId,
            )
            .pipe(
              Effect.flatMap((committed) =>
                Effect.try({
                  try: () => {
                    if (
                      applyResultStoreEpoch(committed) !== input.authority.storeEpoch ||
                      committed.receipt.operation_id !== input.operationId ||
                      committed.receipt.operation_kind !== "persist_agent_project_resource_grants"
                    ) {
                      throw new Error("Core Agent Project grants escaped their receipt boundary");
                    }
                  },
                  catch: (cause) =>
                    new NodexAgentResourceAccessError({ operation: "persist", cause }),
                }),
              ),
              Effect.mapError((cause) =>
                cause instanceof NodexAgentResourceAccessError
                  ? cause
                  : new NodexAgentResourceAccessError({ operation: "persist", cause }),
              ),
            ),
      });
    }),
  );
