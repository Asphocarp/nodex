import type { FrozenNodexAgentTurnAuthority } from "../shared/nodex-agent-authority";
import type { NodexAgentResourceAccessOverlay } from "../shared/nodex-agent-resource-access";
import type { LibraryResource } from "../shared/resource-authorization";

/** Trusted main-to-writer execution guard; never part of a public tool schema. */
export interface NodexAgentMutationExecutionAuthority {
  readonly authority: FrozenNodexAgentTurnAuthority;
  readonly resource: LibraryResource;
  readonly resourceAccess?: NodexAgentResourceAccessOverlay;
  readonly callId: string;
}
