import type { CodexServiceTier, CodexTurnStartOptions } from "@/lib/types";
import type { ThreadFooterModel } from "../../thread-stage-types";
import type { ComposerIntelligenceSelection } from "./composer-intelligence-types";

export type { ComposerIntelligenceSelection } from "./composer-intelligence-types";

export function deriveComposerIntelligenceSelection(
  model: ThreadFooterModel,
  defaultServiceTier: CodexServiceTier,
): ComposerIntelligenceSelection {
  if (model.agentProviderCatalog && model.executionProfile) {
    return {
      kind: "agent",
      profile:
        model.isNewThreadTab && model.executionProfile.serviceTier === null
          ? { ...model.executionProfile, serviceTier: defaultServiceTier }
          : model.executionProfile,
      change: "model",
    };
  }

  return {
    kind: "codex",
    model: model.selectedModel,
    reasoningEffort: model.selectedReasoningEffort,
    serviceTier: model.conversation?.latestThreadSettings?.serviceTier ?? defaultServiceTier,
  };
}

export function areComposerIntelligenceSelectionsEqual(
  left: ComposerIntelligenceSelection,
  right: ComposerIntelligenceSelection,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "codex" && right.kind === "codex") {
    return (
      left.model === right.model &&
      left.reasoningEffort === right.reasoningEffort &&
      left.serviceTier === right.serviceTier
    );
  }
  if (left.kind !== "agent" || right.kind !== "agent") return false;
  return (
    left.profile.providerId === right.profile.providerId &&
    left.profile.harnessId === right.profile.harnessId &&
    left.profile.modelId === right.profile.modelId &&
    left.profile.reasoningEffort === right.profile.reasoningEffort &&
    left.profile.serviceTier === right.profile.serviceTier
  );
}

export function buildComposerIntelligenceTurnOverrides(
  selection: ComposerIntelligenceSelection,
): Pick<CodexTurnStartOptions, "model" | "reasoningEffort" | "serviceTier"> {
  if (selection.kind === "codex") {
    return {
      model: selection.model,
      reasoningEffort: selection.reasoningEffort,
      serviceTier: selection.serviceTier,
    };
  }

  return {};
}
