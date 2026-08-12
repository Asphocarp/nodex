import type { CodexReasoningEffort, CodexServiceTier } from "@/lib/types";
import type {
  AgentExecutionProfile,
  AgentExecutionProfileChange,
} from "../../../../../shared/agent-runtime";

/** The complete next-turn intelligence choice shown by a composer selector. */
export type ComposerIntelligenceSelection =
  | {
      readonly kind: "codex";
      readonly model: string;
      readonly reasoningEffort: CodexReasoningEffort;
      readonly serviceTier: CodexServiceTier;
    }
  | {
      readonly kind: "agent";
      readonly profile: AgentExecutionProfile;
      readonly change: AgentExecutionProfileChange;
    };
