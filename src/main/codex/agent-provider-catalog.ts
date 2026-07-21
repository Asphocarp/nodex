import type {
  InterpreterHarness,
  InterpreterHarnessListResponse,
  InterpreterModelListResponse,
  InterpreterProvider,
  InterpreterProviderListResponse,
  Model,
} from "@nodex/codex-app-server-protocol/v2";
import type {
  AgentExecutionProfile,
  AgentModelOption,
  AgentProviderCatalog,
  AgentProviderCredentialStatus,
  AgentProviderOption,
  AgentWireApi,
} from "../../shared/agent-runtime";

const SUPPORTED_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "kimi-for-coding",
  "moonshotai",
  "openrouter",
] as const;

const SUPPORTED_PROVIDER_ID_SET = new Set<string>(SUPPORTED_PROVIDER_IDS);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_CATALOG_STRING_LENGTH = 512;

export interface AgentProviderCatalogClient {
  request(method: string, params: unknown): Promise<unknown>;
}

export interface AgentProviderCredentialStatusReader {
  status(providerId: string): Promise<AgentProviderCredentialStatus>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCatalogString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Agent runtime ${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_CATALOG_STRING_LENGTH) {
    throw new Error(`Agent runtime ${label} is outside the supported length`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new Error(`Agent runtime ${label} contains control characters`);
  }
  return normalized;
}

function parseOptionalCatalogString(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parseCatalogString(value, label);
}

function parseWireApi(value: unknown): AgentWireApi {
  if (value === "responses" || value === "chat" || value === "messages") return value;
  throw new Error(`Agent runtime advertised unsupported wire API ${String(value)}`);
}

function parseProvider(value: unknown, index: number): InterpreterProvider {
  if (!isRecord(value)) throw new Error(`Agent runtime provider ${index} is invalid`);
  const id = parseCatalogString(value.id, `provider ${index} id`);
  return {
    id,
    name: parseCatalogString(value.name, `provider ${id} name`),
    description: typeof value.description === "string" ? value.description.trim() : "",
    isCurrent: value.isCurrent === true,
    baseUrl: parseOptionalCatalogString(value.baseUrl, `provider ${id} base URL`) ?? undefined,
    wireApi: parseWireApi(value.wireApi),
    envKey: parseOptionalCatalogString(value.envKey, `provider ${id} environment key`) ?? undefined,
    configured: value.configured === true,
    isDefault: value.isDefault === true,
  };
}

function parseProviderResponse(value: unknown): InterpreterProvider[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Agent runtime provider catalog response is invalid");
  }
  return value.data.map(parseProvider);
}

function parseModel(value: unknown, providerId: string, index: number): Model {
  if (!isRecord(value)) throw new Error(`Agent runtime model ${providerId}[${index}] is invalid`);
  const id = parseCatalogString(value.id, `model ${providerId}[${index}] id`);
  const model = parseCatalogString(value.model, `model ${providerId}/${id} runtime id`);
  const reasoning = Array.isArray(value.supportedReasoningEfforts)
    ? value.supportedReasoningEfforts.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const effort = parseOptionalCatalogString(
          entry.reasoningEffort,
          `model ${providerId}/${id} reasoning effort`,
        );
        if (!effort) return [];
        return [{
          reasoningEffort: effort,
          description: typeof entry.description === "string" ? entry.description : "",
        }];
      })
    : [];
  const defaultReasoningEffort = parseOptionalCatalogString(
    value.defaultReasoningEffort,
    `model ${providerId}/${id} default reasoning effort`,
  ) ?? reasoning[0]?.reasoningEffort ?? "none";
  const inputModalities = Array.isArray(value.inputModalities)
    ? value.inputModalities.filter((entry): entry is "text" | "image" => (
        entry === "text" || entry === "image"
      ))
    : [];

  return {
    id,
    model,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: typeof value.displayName === "string" ? value.displayName.trim() : id,
    description: typeof value.description === "string" ? value.description.trim() : "",
    hidden: value.hidden === true,
    supportedReasoningEfforts: reasoning,
    defaultReasoningEffort,
    inputModalities,
    supportsPersonality: value.supportsPersonality === true,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: value.isDefault === true,
  };
}

function parseModelResponse(value: unknown, providerId: string): Model[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error(`Agent runtime model catalog response for ${providerId} is invalid`);
  }
  return value.data.map((entry, index) => parseModel(entry, providerId, index));
}

function parseHarnessResponse(value: unknown, providerId: string): InterpreterHarness[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error(`Agent runtime harness catalog response for ${providerId} is invalid`);
  }
  return value.data.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Agent runtime harness ${providerId}[${index}] is invalid`);
    const id = parseOptionalCatalogString(entry.id, `harness ${providerId}[${index}] id`);
    return {
      ...(id ? { id } : {}),
      label: parseCatalogString(entry.label, `harness ${providerId}[${index}] label`),
      description: typeof entry.description === "string" ? entry.description.trim() : "",
      isRecommended: entry.isRecommended === true,
    };
  });
}

function recommendedHarnessId(harnesses: readonly InterpreterHarness[]): string | null {
  const recommended = harnesses.find((harness) => harness.isRecommended);
  if (!recommended) throw new Error("Agent runtime did not advertise a recommended harness");
  return recommended.id ?? null;
}

export async function resolveAgentHarnessId(input: {
  client: AgentProviderCatalogClient;
  providerId: string;
  modelId: string;
  requestedHarnessId: string | null;
  fallbackHarnessId: string | null;
}): Promise<string | null> {
  if (!SUPPORTED_PROVIDER_ID_SET.has(input.providerId)) {
    throw new Error(`Unsupported agent provider: ${input.providerId}`);
  }
  const rawHarnesses = await input.client.request("interpreter/harness/list", {
    providerId: input.providerId,
    model: input.modelId,
  });
  const harnesses = parseHarnessResponse(rawHarnesses, input.providerId);

  if (input.requestedHarnessId) {
    if (!harnesses.some((harness) => harness.id === input.requestedHarnessId)) {
      throw new Error(
        `Agent harness '${input.requestedHarnessId}' is unavailable for ${input.providerId}/${input.modelId}`,
      );
    }
    return input.requestedHarnessId;
  }

  const recommended = harnesses.find((harness) => harness.isRecommended);
  return recommended ? recommended.id ?? null : input.fallbackHarnessId;
}

export async function resolveAgentExecutionProfileFromCatalog(input: {
  client: AgentProviderCatalogClient;
  catalog: AgentProviderCatalog;
  requested: AgentExecutionProfile;
}): Promise<AgentExecutionProfile> {
  const { catalog, client, requested } = input;
  const provider = catalog.providers.find((option) => option.id === requested.providerId);
  if (!provider?.supportedByNodex) {
    throw new Error(`Unsupported agent provider: ${requested.providerId}`);
  }
  const model = provider.models.find((option) => option.modelId === requested.modelId);
  if (!model) {
    throw new Error(
      `Agent model '${requested.modelId}' is unavailable for provider '${requested.providerId}'`,
    );
  }
  if (
    provider.credentialStatus !== "ready"
    && provider.credentialStatus !== "inherited"
    && provider.credentialStatus !== "runtimeManaged"
  ) {
    throw new Error(`Agent provider '${requested.providerId}' needs an API key`);
  }

  const supportedReasoningEfforts = model.supportedReasoningEfforts.map((option) => option.value);
  const advertisedDefaultReasoningEffort = model.defaultReasoningEffort
    && supportedReasoningEfforts.includes(model.defaultReasoningEffort)
    ? model.defaultReasoningEffort
    : null;
  const reasoningEffort = requested.reasoningEffort
    ?? advertisedDefaultReasoningEffort
    ?? model.supportedReasoningEfforts[0]?.value
    ?? null;
  if (
    reasoningEffort
    && !supportedReasoningEfforts.includes(reasoningEffort)
  ) {
    throw new Error(
      `Reasoning effort '${reasoningEffort}' is unavailable for ${requested.providerId}/${requested.modelId}`,
    );
  }
  if (requested.providerId !== "openai" && requested.serviceTier) {
    throw new Error(`Service tier is unsupported for agent provider '${requested.providerId}'`);
  }

  const harnessId = await resolveAgentHarnessId({
    client,
    providerId: requested.providerId,
    modelId: requested.modelId,
    requestedHarnessId: requested.harnessId === provider.recommendedHarnessId
      ? null
      : requested.harnessId,
    fallbackHarnessId: provider.recommendedHarnessId,
  });
  return {
    providerId: requested.providerId,
    modelId: requested.modelId,
    harnessId,
    reasoningEffort,
    serviceTier: requested.serviceTier,
  };
}

function toModelOption(
  providerId: string,
  model: Model,
  providerRecommendedHarnessId: string | null,
): AgentModelOption {
  return {
    providerId,
    modelId: model.id,
    displayName: model.displayName || model.id,
    description: model.description || null,
    hidden: model.hidden,
    isDefault: model.isDefault,
    recommendedHarnessId: providerRecommendedHarnessId,
    supportedReasoningEfforts: model.supportedReasoningEfforts.map((option) => ({
      value: option.reasoningEffort,
      description: option.description || null,
    })),
    defaultReasoningEffort: model.defaultReasoningEffort || null,
    inputCapabilities: model.inputModalities,
    switchPolicy: providerId === "openai" ? "same-thread" : "new-thread",
  };
}

async function discoverProvider(input: {
  client: AgentProviderCatalogClient;
  credentialStatusReader: AgentProviderCredentialStatusReader;
  provider: InterpreterProvider;
}): Promise<AgentProviderOption> {
  const { client, credentialStatusReader, provider } = input;
  const [rawModels, rawHarnesses, credentialStatus] = await Promise.all([
    client.request("interpreter/model/list", {
      modelProvider: provider.id,
      includeHidden: false,
    }),
    client.request("interpreter/harness/list", {
      providerId: provider.id,
      model: null,
    }),
    credentialStatusReader.status(provider.id),
  ]);
  const models = parseModelResponse(rawModels as InterpreterModelListResponse, provider.id);
  const harnesses = parseHarnessResponse(rawHarnesses as InterpreterHarnessListResponse, provider.id);
  const providerRecommendedHarnessId = recommendedHarnessId(harnesses);

  return {
    id: provider.id,
    displayName: provider.name,
    description: provider.description || null,
    wireApi: parseWireApi(provider.wireApi),
    credentialStatus,
    supportedByNodex: true,
    isDefault: provider.isDefault,
    credentialEnvKey: provider.envKey ?? null,
    recommendedHarnessId: providerRecommendedHarnessId,
    models: models.map((model) => (
      toModelOption(provider.id, model, providerRecommendedHarnessId)
    )),
  };
}

export async function discoverAgentProviderCatalog(input: {
  client: AgentProviderCatalogClient;
  credentialStatusReader: AgentProviderCredentialStatusReader;
}): Promise<AgentProviderCatalog> {
  const rawProviders = await input.client.request("interpreter/provider/list", {
    includeUnconfigured: true,
  });
  const providers = parseProviderResponse(rawProviders as InterpreterProviderListResponse)
    .filter((provider) => SUPPORTED_PROVIDER_ID_SET.has(provider.id));
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const orderedProviders = SUPPORTED_PROVIDER_IDS.flatMap((providerId) => {
    const provider = providerById.get(providerId);
    return provider ? [provider] : [];
  });
  const catalogProviders = await Promise.all(orderedProviders.map((provider) => (
    discoverProvider({ ...input, provider })
  )));
  return { providers: catalogProviders };
}
