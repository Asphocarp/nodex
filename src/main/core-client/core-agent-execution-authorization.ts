import type { components } from "@nodex/core-protocol";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import {
  canonicalizeNodexAgentResourceGrantSpecs,
  type NodexAgentResourceAccessOverlay,
  type NodexAgentResourceGrantRoot,
  type NodexAgentResourceGrantSpec,
} from "../../shared/nodex-agent-resource-access";

type CoreAgentGrant = components["schemas"]["AgentResourceGrantSpec"];
type CoreAgentOverlay = components["schemas"]["AgentResourceAccessOverlay"];

export const toCoreAgentTurnProvenance = (
  profileId: string,
  authority: FrozenNodexAgentTurnAuthority,
) =>
  ({
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

const toCoreGrantRoot = (root: NodexAgentResourceGrantRoot): CoreAgentGrant["root"] => {
  switch (root.kind) {
    case "page":
      return { kind: root.kind, page_id: root.pageId };
    case "database":
      return { kind: root.kind, database_id: root.databaseId };
    case "library":
      return { kind: root.kind, library_id: root.libraryId };
  }
};

const toCoreGrant = (grant: NodexAgentResourceGrantSpec): CoreAgentGrant => ({
  root: toCoreGrantRoot(grant.root),
  access: grant.access,
  ...(grant.libraryActions ? { library_actions: grant.libraryActions } : {}),
});

const toCoreOverlay = (overlay: NodexAgentResourceAccessOverlay): CoreAgentOverlay => ({
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
  ...(overlay.persistResultingPageGrants ? { persist_resulting_page_grants: true } : {}),
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
