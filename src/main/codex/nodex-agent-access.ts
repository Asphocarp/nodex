import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import type { NodexAgentAccess } from "../../shared/nodex-agent-tools";

export const resolveNodexAgentWriteAccess = (input: {
  readonly authorityScope: FrozenNodexAgentTurnAuthority["scope"] | null;
  readonly hasActorProject: boolean;
}): NodexAgentAccess["write"] => {
  if (!input.hasActorProject || input.authorityScope === null) {
    return "unavailable";
  }
  return "granted";
};
