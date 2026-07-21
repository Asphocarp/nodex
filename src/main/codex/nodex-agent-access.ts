import {
  nodexAgentAuthorityFingerprint,
  type FrozenNodexAgentTurnAuthority,
} from "../../shared/nodex-agent-authority";
import type { NodexAgentAccess } from "../../shared/nodex-agent-tools";

export const canAutoApproveNodexAgentWrite = (
  frozen: FrozenNodexAgentTurnAuthority | null,
  current: FrozenNodexAgentTurnAuthority | null,
): boolean => frozen?.scope === "library"
  && current?.scope === "library"
  && nodexAgentAuthorityFingerprint(frozen)
    === nodexAgentAuthorityFingerprint(current);

export const resolveNodexAgentWriteAccess = (input: {
  readonly authorityScope: FrozenNodexAgentTurnAuthority["scope"] | null;
  readonly hasActorProject: boolean;
}): NodexAgentAccess["write"] => {
  if (!input.hasActorProject || input.authorityScope === null) {
    return "unavailable";
  }
  return "granted";
};
