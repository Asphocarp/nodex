import type {
  NodexAgentResourceAccessOverlay,
  NodexAgentResourceAccessPlan,
  NodexAgentResourceIntent,
  PersistNodexAgentProjectResourceGrantsInput,
} from "../shared/nodex-agent-resource-access";
import type { FrozenNodexAgentTurnAuthority } from "../shared/nodex-agent-authority";

export interface PlanNodexAgentResourceAccessInput {
  readonly authority: FrozenNodexAgentTurnAuthority;
  readonly callId: string;
  readonly intents: readonly NodexAgentResourceIntent[];
  readonly taskAccess?: NodexAgentResourceAccessOverlay;
}

export interface NodexAgentResourceAuthorityPort {
  plan(input: PlanNodexAgentResourceAccessInput): Promise<NodexAgentResourceAccessPlan>;
  persistProjectGrants(input: PersistNodexAgentProjectResourceGrantsInput): Promise<void>;
}
