import type { CodexReasoningEffort, CodexModelOption } from "@/lib/types";

export interface ComposerPowerChoice {
  readonly id: string;
  readonly model: string;
  readonly reasoningEffort: CodexReasoningEffort;
  readonly modelLabel: string;
  readonly reasoningLabel: string;
  readonly isUltra: boolean;
}

export interface ComposerPowerPolicy {
  readonly source: "primary" | "terraFallback";
  readonly choices: readonly ComposerPowerChoice[];
}

const PRIMARY_CHOICES = [
  ["gpt-5.6-terra", "low"],
  ["gpt-5.6-sol", "low"],
  ["gpt-5.6-sol", "medium"],
  ["gpt-5.6-sol", "high"],
  ["gpt-5.6-sol", "xhigh"],
  ["gpt-5.6-sol", "ultra"],
] as const satisfies readonly (readonly [string, CodexReasoningEffort])[];

const TERRA_FALLBACK_CHOICES = [
  ["gpt-5.6-terra", "low"],
  ["gpt-5.6-terra", "medium"],
  ["gpt-5.6-terra", "high"],
  ["gpt-5.6-terra", "xhigh"],
] as const satisfies readonly (readonly [string, CodexReasoningEffort])[];

const REASONING_LABELS: Readonly<Record<string, string>> = {
  low: "Light",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  ultra: "Ultra",
};

function formatPowerModelLabel(modelId: string, models: readonly CodexModelOption[]): string {
  const label = models.find((model) => model.id === modelId)?.displayName ?? modelId;
  const withoutPrefix = label.trim().replace(/^GPT(?:[-\s])?/iu, "");
  const withoutCodexSuffix = withoutPrefix.replace(/(?:[-\s])?Codex.*$/iu, "");
  return withoutCodexSuffix.trim() || label;
}

function buildChoices(
  policy: readonly (readonly [string, CodexReasoningEffort])[],
  models: readonly CodexModelOption[],
): readonly ComposerPowerChoice[] {
  const visibleModels = new Map(
    models.filter((model) => !model.hidden).map((model) => [model.id, model] as const),
  );

  return policy.flatMap(([modelId, reasoningEffort]) => {
    const model = visibleModels.get(modelId);
    if (!model) return [];
    const supportsEffort = model.supportedReasoningEfforts.some(
      (option) => option.reasoningEffort === reasoningEffort,
    );
    if (!supportsEffort) return [];

    return [
      {
        id: `${modelId}:${reasoningEffort}`,
        model: modelId,
        reasoningEffort,
        modelLabel: formatPowerModelLabel(modelId, models),
        reasoningLabel: REASONING_LABELS[reasoningEffort] ?? reasoningEffort,
        isUltra: reasoningEffort === "ultra",
      },
    ];
  });
}

export function resolveComposerPowerPolicy(
  models: readonly CodexModelOption[],
): ComposerPowerPolicy | null {
  const primary = buildChoices(PRIMARY_CHOICES, models);
  if (primary.length >= 3) {
    return { source: "primary", choices: primary };
  }

  const fallback = buildChoices(TERRA_FALLBACK_CHOICES, models);
  if (fallback.length >= 3) {
    return { source: "terraFallback", choices: fallback };
  }

  return null;
}

export function findComposerPowerChoiceIndex(
  choices: readonly ComposerPowerChoice[],
  model: string,
  reasoningEffort: CodexReasoningEffort,
): number {
  return choices.findIndex(
    (choice) => choice.model === model && choice.reasoningEffort === reasoningEffort,
  );
}
