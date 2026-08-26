import type { Model } from "@nodex/codex-app-server-protocol/v2";
import {
  formatAgentReasoningEffortLabel,
  type AgentModelOption,
  type AgentWireApi,
} from "../../shared/agent-runtime";

export const SUPPORTED_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "kimi-for-coding",
  "moonshotai",
  "openrouter",
] as const;

/** Open Interpreter extension payload, parsed at the raw app-server boundary. */
export interface InterpreterProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isCurrent: boolean;
  readonly baseUrl?: string;
  readonly wireApi: AgentWireApi;
  readonly envKey?: string;
  readonly configured: boolean;
  readonly isDefault: boolean;
}

/** Open Interpreter extension payload, parsed at the raw app-server boundary. */
export interface InterpreterHarness {
  readonly id?: string;
  readonly label: string;
  readonly description: string;
  readonly isRecommended: boolean;
}

type InterpreterModel = Pick<
  Model,
  | "id"
  | "model"
  | "displayName"
  | "description"
  | "modelSpecialty"
  | "hidden"
  | "supportedReasoningEfforts"
  | "defaultReasoningEffort"
  | "inputModalities"
  | "supportsPersonality"
  | "serviceTiers"
  | "defaultServiceTier"
  | "isDefault"
>;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_CATALOG_STRING_LENGTH = 512;

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

export function parseWireApi(value: unknown): AgentWireApi {
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

export function parseProviderResponse(value: unknown): InterpreterProvider[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Agent runtime provider catalog response is invalid");
  }
  return value.data.map(parseProvider);
}

function parseModel(value: unknown, providerId: string, index: number): InterpreterModel {
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
        return [
          {
            reasoningEffort: effort,
            description: typeof entry.description === "string" ? entry.description : "",
          },
        ];
      })
    : [];
  const defaultReasoningEffort =
    parseOptionalCatalogString(
      value.defaultReasoningEffort,
      `model ${providerId}/${id} default reasoning effort`,
    ) ??
    reasoning[0]?.reasoningEffort ??
    "none";
  const inputModalities = Array.isArray(value.inputModalities)
    ? value.inputModalities.filter(
        (entry): entry is "text" | "image" => entry === "text" || entry === "image",
      )
    : [];
  const serviceTiers = Array.isArray(value.serviceTiers)
    ? value.serviceTiers.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const tierId = parseOptionalCatalogString(
          entry.id,
          `model ${providerId}/${id} service tier id`,
        );
        if (!tierId) return [];
        return [
          {
            id: tierId,
            name: parseCatalogString(entry.name, `model ${providerId}/${id} service tier name`),
            description: typeof entry.description === "string" ? entry.description.trim() : "",
          },
        ];
      })
    : [];
  const defaultServiceTier = parseOptionalCatalogString(
    value.defaultServiceTier,
    `model ${providerId}/${id} default service tier`,
  );

  return {
    id,
    model,
    displayName: typeof value.displayName === "string" ? value.displayName.trim() : id,
    description: typeof value.description === "string" ? value.description.trim() : "",
    modelSpecialty: parseOptionalCatalogString(
      value.modelSpecialty,
      `model ${providerId}/${id} specialty`,
    ),
    hidden: value.hidden === true,
    supportedReasoningEfforts: reasoning,
    defaultReasoningEffort,
    inputModalities,
    supportsPersonality: value.supportsPersonality === true,
    serviceTiers,
    defaultServiceTier,
    isDefault: value.isDefault === true,
  };
}

export function parseModelResponse(value: unknown, providerId: string): InterpreterModel[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error(`Agent runtime model catalog response for ${providerId} is invalid`);
  }
  return value.data.map((entry, index) => parseModel(entry, providerId, index));
}

export function parseHarnessResponse(value: unknown, providerId: string): InterpreterHarness[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error(`Agent runtime harness catalog response for ${providerId} is invalid`);
  }
  return value.data.map((entry, index) => {
    if (!isRecord(entry))
      throw new Error(`Agent runtime harness ${providerId}[${index}] is invalid`);
    const id = parseOptionalCatalogString(entry.id, `harness ${providerId}[${index}] id`);
    return {
      ...(id ? { id } : {}),
      label: parseCatalogString(entry.label, `harness ${providerId}[${index}] label`),
      description: typeof entry.description === "string" ? entry.description.trim() : "",
      isRecommended: entry.isRecommended === true,
    };
  });
}

export function recommendedHarnessId(harnesses: readonly InterpreterHarness[]): string | null {
  const recommended = harnesses.find((harness) => harness.isRecommended);
  if (!recommended) throw new Error("Agent runtime did not advertise a recommended harness");
  return recommended.id ?? null;
}

export function toModelOption(
  providerId: string,
  model: InterpreterModel,
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
      displayName: formatAgentReasoningEffortLabel(option.reasoningEffort),
      description: option.description || null,
    })),
    defaultReasoningEffort: model.defaultReasoningEffort || null,
    supportedServiceTiers:
      model.serviceTiers.length > 0
        ? [
            {
              value: null,
              displayName: "Standard",
              description: "Default speed, normal usage",
            },
            ...model.serviceTiers.map((tier) => ({
              value: tier.id,
              displayName: tier.name,
              description: tier.description || null,
            })),
          ]
        : [],
    defaultServiceTier: model.defaultServiceTier || null,
    inputCapabilities: model.inputModalities,
    switchPolicy: providerId === "openai" ? "same-thread" : "new-thread",
  };
}
