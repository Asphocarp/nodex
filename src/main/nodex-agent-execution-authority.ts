import type { FrozenNodexAgentTurnAuthority } from "../shared/nodex-agent-authority";
import type { LibraryResource } from "../shared/resource-authorization";

/** Trusted main-to-writer execution guard; never part of a public tool schema. */
export interface NodexAgentMutationExecutionAuthority {
  readonly authority: FrozenNodexAgentTurnAuthority;
  readonly resource: LibraryResource;
}
