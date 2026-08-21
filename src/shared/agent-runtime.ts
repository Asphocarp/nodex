export type AgentWireApi = "responses" | "chat" | "messages";

export type AgentProviderCredentialStatus =
  | "ready"
  | "inherited"
  | "runtimeManaged"
  | "missing"
  | "unavailable"
  | "unsupported";

export interface AgentRuntimeBinding {
  readonly providerId: string;
  readonly harnessId: string | null;
}

export interface AgentTurnIntelligence {
  readonly modelId: string;
  readonly reasoningEffort: string | null;
  readonly serviceTier: string | null;
}

/**
 * Durable projection of a task's immutable runtime binding plus its mutable
 * next-turn intelligence settings.
 */
export interface AgentExecutionProfile extends AgentRuntimeBinding, AgentTurnIntelligence {}

export type AgentExecutionProfileChange = "provider" | "model" | "reasoningEffort" | "serviceTier";

export interface AgentReasoningEffortOption {
  readonly value: string;
  readonly displayName: string;
  readonly description: string | null;
}

export interface AgentServiceTierOption {
  readonly value: string | null;
  readonly displayName: string;
  readonly description: string | null;
}

export function isFastAgentServiceTierOption(
  option: Pick<AgentServiceTierOption, "value" | "displayName">,
): boolean {
  return (
    option.value?.trim().toLocaleLowerCase() === "fast" ||
    option.displayName.trim().toLocaleLowerCase() === "fast"
  );
}

export interface AgentModelOption {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly hidden: boolean;
  readonly isDefault: boolean;
  readonly recommendedHarnessId: string | null;
  readonly supportedReasoningEfforts: readonly AgentReasoningEffortOption[];
  readonly defaultReasoningEffort: string | null;
  readonly supportedServiceTiers: readonly AgentServiceTierOption[];
  readonly defaultServiceTier: string | null;
  readonly inputCapabilities: readonly ("text" | "image" | "audio")[];
  readonly switchPolicy: "same-thread" | "new-thread";
}

export interface AgentProviderOption {
  readonly id: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly wireApi: AgentWireApi;
  readonly credentialStatus: AgentProviderCredentialStatus;
  readonly supportedByNodex: boolean;
  readonly isDefault: boolean;
  readonly credentialEnvKey: string | null;
  readonly recommendedHarnessId: string | null;
  readonly models: readonly AgentModelOption[];
}

export interface AgentProviderCatalog {
  readonly providers: readonly AgentProviderOption[];
}

export interface AgentProviderCredentialMutationInput {
  readonly providerId: string;
  readonly apiKey: string;
}

export interface AgentProviderCredentialDeleteInput {
  readonly providerId: string;
}

export interface AgentProviderCredentialMutationResult {
  readonly providerId: string;
  readonly status: AgentProviderCredentialStatus;
  readonly runtimeRestartPending: boolean;
}

const AGENT_REASONING_EFFORT_LABELS: Readonly<Record<string, string>> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  ultra: "Ultra",
  none: "Default",
};

export function formatAgentReasoningEffortLabel(value: string): string {
  const knownLabel = AGENT_REASONING_EFFORT_LABELS[value.toLocaleLowerCase()];
  if (knownLabel) return knownLabel;
  if (/[A-Z]/u.test(value)) return value;

  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function encodeAgentModelKey(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId]);
}

export function decodeAgentModelKey(value: string): { providerId: string; modelId: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [providerId, modelId] = parsed;
  if (typeof providerId !== "string" || typeof modelId !== "string") return null;
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}
