import type {
  AgentExecutionProfile,
  AgentModelOption,
  AgentProviderCatalog,
  AgentProviderOption,
} from "../../shared/agent-runtime";

export const AGENT_EXECUTION_PROFILE_STORAGE_KEY = "nodex-agent-execution-profile-v1";

const MAX_PROFILE_VALUE_LENGTH = 512;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function normalizeProfileValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_PROFILE_VALUE_LENGTH) return null;
  return CONTROL_CHARACTER_PATTERN.test(normalized) ? null : normalized;
}

function normalizeNullableProfileValue(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return normalizeProfileValue(value) ?? undefined;
}

export function parseStoredAgentExecutionProfile(value: unknown): AgentExecutionProfile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const providerId = normalizeProfileValue(record.providerId);
  const modelId = normalizeProfileValue(record.modelId);
  const harnessId = normalizeNullableProfileValue(record.harnessId);
  const reasoningEffort = normalizeNullableProfileValue(record.reasoningEffort);
  const serviceTier = normalizeNullableProfileValue(record.serviceTier);
  if (!providerId || !modelId) return null;
  if (harnessId === undefined || reasoningEffort === undefined || serviceTier === undefined) {
    return null;
  }

  return {
    providerId,
    modelId,
    harnessId,
    reasoningEffort,
    serviceTier,
  };
}

export function readStoredAgentExecutionProfile(): AgentExecutionProfile | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(AGENT_EXECUTION_PROFILE_STORAGE_KEY);
    return raw ? parseStoredAgentExecutionProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeStoredAgentExecutionProfile(profile: AgentExecutionProfile): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(AGENT_EXECUTION_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Selection persistence is best-effort; the main process still validates every launch.
  }
}

export function findAgentProvider(
  catalog: AgentProviderCatalog | null | undefined,
  providerId: string,
): AgentProviderOption | null {
  return catalog?.providers.find((provider) => provider.id === providerId) ?? null;
}

export function findAgentModel(
  catalog: AgentProviderCatalog | null | undefined,
  profile: Pick<AgentExecutionProfile, "providerId" | "modelId">,
): AgentModelOption | null {
  return findAgentProvider(catalog, profile.providerId)?.models.find((model) => (
    !model.hidden && model.modelId === profile.modelId
  )) ?? null;
}

function resolveReasoningEffort(
  model: AgentModelOption,
  requested: string | null | undefined,
): string | null {
  const efforts = model.supportedReasoningEfforts.map((option) => option.value);
  if (requested && efforts.includes(requested)) return requested;
  if (model.defaultReasoningEffort && efforts.includes(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort;
  }
  return efforts[0] ?? null;
}

function resolveServiceTier(
  model: AgentModelOption,
  requested: string | null | undefined,
): string | null {
  const tiers = model.supportedServiceTiers.map((option) => option.value);
  if (requested !== undefined && tiers.includes(requested)) return requested;
  if (tiers.includes(model.defaultServiceTier)) return model.defaultServiceTier;
  return tiers[0] ?? null;
}

export function buildAgentExecutionProfile(input: {
  model: AgentModelOption;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
}): AgentExecutionProfile {
  return {
    providerId: input.model.providerId,
    modelId: input.model.modelId,
    harnessId: input.model.recommendedHarnessId,
    reasoningEffort: resolveReasoningEffort(input.model, input.reasoningEffort),
    serviceTier: resolveServiceTier(input.model, input.serviceTier),
  };
}

function defaultProvider(catalog: AgentProviderCatalog): AgentProviderOption | null {
  return catalog.providers.find((provider) => provider.isDefault)
    ?? catalog.providers.find((provider) => provider.id === "openai")
    ?? catalog.providers[0]
    ?? null;
}

function defaultModel(provider: AgentProviderOption): AgentModelOption | null {
  return provider.models.find((model) => !model.hidden && model.isDefault)
    ?? provider.models.find((model) => !model.hidden)
    ?? null;
}

export function resolveAgentExecutionProfile(input: {
  catalog: AgentProviderCatalog | null | undefined;
  storedProfile?: AgentExecutionProfile | null;
  legacyModelId?: string | null;
  legacyReasoningEffort?: string | null;
  serviceTier?: string | null;
}): AgentExecutionProfile | null {
  const catalog = input.catalog;
  if (!catalog) return null;

  if (input.storedProfile) {
    const storedModel = findAgentModel(catalog, input.storedProfile);
    if (storedModel) {
      return buildAgentExecutionProfile({
        model: storedModel,
        reasoningEffort: input.storedProfile.reasoningEffort,
        serviceTier: input.serviceTier === undefined
          ? input.storedProfile.serviceTier
          : input.serviceTier,
      });
    }
  }

  const provider = defaultProvider(catalog);
  if (!provider) return null;
  const legacyModel = provider.id === "openai" && input.legacyModelId
    ? provider.models.find((model) => !model.hidden && model.modelId === input.legacyModelId)
    : null;
  const model = legacyModel ?? defaultModel(provider);
  if (!model) return null;

  return buildAgentExecutionProfile({
    model,
    reasoningEffort: legacyModel ? input.legacyReasoningEffort : null,
    serviceTier: input.serviceTier,
  });
}

export function selectAgentProvider(
  catalog: AgentProviderCatalog,
  providerId: string,
  current: AgentExecutionProfile | null,
): AgentExecutionProfile | null {
  const provider = findAgentProvider(catalog, providerId);
  if (!provider) return null;
  const model = defaultModel(provider);
  if (!model) return null;
  return buildAgentExecutionProfile({
    model,
    reasoningEffort: current?.providerId === providerId ? current.reasoningEffort : null,
    serviceTier: current?.providerId === providerId ? current.serviceTier : undefined,
  });
}

export function selectAgentModel(
  model: AgentModelOption,
  current: AgentExecutionProfile | null,
): AgentExecutionProfile {
  const next = buildAgentExecutionProfile({
    model,
    reasoningEffort: current?.providerId === model.providerId ? current.reasoningEffort : null,
    serviceTier: current?.providerId === model.providerId ? current.serviceTier : undefined,
  });
  if (current?.providerId !== model.providerId) return next;
  return {
    ...next,
    harnessId: current.harnessId,
  };
}

export function resolveEffectiveAgentExecutionProfile(input: {
  catalog: AgentProviderCatalog | null | undefined;
  activeThreadId: string | null;
  threadProfile: AgentExecutionProfile | null | undefined;
  threadModelProvider: string | null | undefined;
  liveModel: string | null | undefined;
  liveReasoningEffort: string | null | undefined;
  liveServiceTier: string | null | undefined;
  draftProfile: AgentExecutionProfile | null | undefined;
}): AgentExecutionProfile | null {
  if (!input.activeThreadId) return input.draftProfile ?? null;

  const catalog = input.catalog;
  if (!catalog) return null;
  const providerId = input.threadProfile?.providerId
    ?? normalizeProfileValue(input.threadModelProvider);
  if (!providerId) return null;
  const provider = findAgentProvider(catalog, providerId);
  if (!provider) return null;

  const liveModelId = normalizeProfileValue(input.liveModel);
  const baseModelId = input.threadProfile?.modelId ?? liveModelId;
  const requestedModel = liveModelId
    ? provider.models.find((model) => !model.hidden && model.modelId === liveModelId)
    : null;
  const baseModel = baseModelId
    ? provider.models.find((model) => !model.hidden && model.modelId === baseModelId)
    : null;
  const model = requestedModel ?? baseModel;
  if (!model) return null;

  const base = buildAgentExecutionProfile({
    model,
    reasoningEffort: input.liveReasoningEffort
      ?? input.threadProfile?.reasoningEffort
      ?? null,
    serviceTier: input.liveServiceTier === undefined
      ? input.threadProfile?.serviceTier
      : input.liveServiceTier,
  });
  return {
    ...base,
    harnessId: input.threadProfile?.harnessId ?? model.recommendedHarnessId,
  };
}

export function selectAgentReasoningEffort(
  catalog: AgentProviderCatalog,
  current: AgentExecutionProfile,
  reasoningEffort: string,
): AgentExecutionProfile | null {
  const model = findAgentModel(catalog, current);
  if (!model) return null;
  if (!model.supportedReasoningEfforts.some((option) => option.value === reasoningEffort)) {
    return null;
  }
  return { ...current, reasoningEffort };
}

export function isAgentProviderCredentialReady(provider: AgentProviderOption): boolean {
  return provider.credentialStatus === "ready"
    || provider.credentialStatus === "inherited"
    || provider.credentialStatus === "runtimeManaged";
}
