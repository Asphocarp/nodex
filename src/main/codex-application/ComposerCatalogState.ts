import type {
  CodexModelOption,
  CodexReasoningEffort,
  CodexReasoningEffortOption,
} from "../../shared/types";

const parseReasoningEffort = (value: unknown): CodexReasoningEffort | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 64) return null;
  return /[\u0000-\u001f\u007f-\u009f]/u.test(normalized) ? null : normalized;
};

const parseReasoningEffortOption = (value: unknown): CodexReasoningEffortOption | null => {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const reasoningEffort = parseReasoningEffort(
    candidate.reasoningEffort ?? candidate.reasoning_effort,
  );
  if (!reasoningEffort) return null;
  return {
    reasoningEffort,
    description: typeof candidate.description === "string" ? candidate.description : "",
  };
};

export const parseModelOption = (value: unknown): CodexModelOption | null => {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.model !== "string") return null;
  const rawSupportedReasoningEfforts =
    candidate.supportedReasoningEfforts ?? candidate.supported_reasoning_efforts;
  const supportedReasoningEfforts = Array.isArray(rawSupportedReasoningEfforts)
    ? rawSupportedReasoningEfforts
        .map(parseReasoningEffortOption)
        .filter((option): option is CodexReasoningEffortOption => option !== null)
    : [];
  const defaultReasoningEffort =
    parseReasoningEffort(candidate.defaultReasoningEffort ?? candidate.default_reasoning_effort) ??
    supportedReasoningEfforts[0]?.reasoningEffort;
  if (!defaultReasoningEffort) return null;
  return {
    id: candidate.id,
    model: candidate.model,
    displayName:
      typeof candidate.displayName === "string"
        ? candidate.displayName
        : typeof candidate.display_name === "string"
          ? candidate.display_name
          : candidate.id,
    description: typeof candidate.description === "string" ? candidate.description : "",
    hidden: Boolean(candidate.hidden),
    supportedReasoningEfforts,
    defaultReasoningEffort,
    isDefault: Boolean(candidate.isDefault ?? candidate.is_default),
  };
};
