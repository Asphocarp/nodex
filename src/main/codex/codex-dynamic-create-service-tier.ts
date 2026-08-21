import type { Config } from "@nodex/codex-app-server-protocol/v2/Config";
import { expandCodexDynamicCreateConfigProfile } from "./codex-dynamic-create-config";

export type CodexCreateThreadServiceTierSelector =
  | { readonly type: "fromConfig" }
  | { readonly type: "standard" }
  | { readonly type: "custom"; readonly serviceTier: string };

export interface CodexCreateThreadServiceTierModel {
  readonly id: string;
  readonly model: string;
  readonly isDefault: boolean;
  readonly defaultServiceTier: string | null;
  readonly serviceTiers: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}

export interface CodexCreateThreadServiceTierDependencies {
  readonly readAuth: (input: { readonly hostId: string }) => Promise<string | null>;
  readonly readRequirements: (input: { readonly hostId: string }) => Promise<{
    readonly requirements?: {
      readonly featureRequirements?: {
        readonly fast_mode?: boolean | null;
      } | null;
    } | null;
  }>;
  readonly readConfig: (input: {
    readonly hostId: string;
    readonly cwd: null;
    readonly includeLayers: false;
  }) => Promise<Readonly<Partial<Config>>>;
  readonly listModels: (input: {
    readonly hostId: string;
    readonly includeHidden: true;
    readonly cursor: null;
    readonly limit: 100;
  }) => Promise<{ readonly data: readonly CodexCreateThreadServiceTierModel[] }>;
  readonly onError?: (input: {
    readonly phase: "request" | "models";
    readonly error: unknown;
  }) => void;
}

export interface ResolveCodexCreateThreadServiceTierInput {
  readonly destinationHostId: string;
  /**
   * Retained as part of the destination launch context. Service-tier selection itself is
   * host-global and therefore reads config with a null cwd.
   */
  readonly destinationCwd: string | null;
  readonly model: string | null;
  readonly selector?: CodexCreateThreadServiceTierSelector;
}

const FROM_CONFIG_SERVICE_TIER_SELECTOR = {
  type: "fromConfig",
} as const satisfies CodexCreateThreadServiceTierSelector;

function resolveSelectorServiceTier(
  selector: Exclude<CodexCreateThreadServiceTierSelector, { readonly type: "fromConfig" }>,
): string {
  if (selector.type === "standard") return "default";
  return selector.serviceTier;
}

function normalizeServiceTierKind(id: string | null, name?: string): "fast" | "ultrafast" | null {
  const normalizedName = name?.trim().toLowerCase();
  if (id === "priority" || id === "fast" || normalizedName === "fast") return "fast";
  if (id === "ultrafast" || normalizedName === "ultrafast") return "ultrafast";
  return null;
}

function resolveFastServiceTier(
  model: CodexCreateThreadServiceTierModel,
): CodexCreateThreadServiceTierModel["serviceTiers"][number] | null {
  return (
    model.serviceTiers.find(
      (tier) =>
        normalizeServiceTierKind(tier.id, tier.name) === "fast" ||
        tier.name.trim().toLowerCase() === "priority",
    ) ?? null
  );
}

function resolveModelServiceTier(
  model: CodexCreateThreadServiceTierModel,
  serviceTier: string,
): CodexCreateThreadServiceTierModel["serviceTiers"][number] | null {
  if (serviceTier === "fast") return resolveFastServiceTier(model);
  return model.serviceTiers.find((tier) => tier.id === serviceTier) ?? null;
}

function projectServiceTier(
  model: CodexCreateThreadServiceTierModel | null,
  selectedServiceTier: string | null,
  fastModeEnabled: boolean,
): string | null {
  if (!fastModeEnabled) return null;
  if (selectedServiceTier !== null) {
    return selectedServiceTier === "default" ? null : selectedServiceTier;
  }

  const defaultServiceTier = model?.defaultServiceTier ?? null;
  if (defaultServiceTier === null || model === null) return null;
  return resolveModelServiceTier(model, defaultServiceTier)?.id ?? null;
}

async function readFastModeEnabled(
  hostId: string,
  dependencies: CodexCreateThreadServiceTierDependencies,
): Promise<boolean> {
  const auth = await dependencies.readAuth({ hostId });
  if (auth !== "chatgpt") return false;
  const requirements = await dependencies.readRequirements({ hostId });
  return requirements.requirements?.featureRequirements?.fast_mode !== false;
}

async function readSelectedModel(
  input: {
    readonly hostId: string;
    readonly model: string | null;
  },
  dependencies: CodexCreateThreadServiceTierDependencies,
): Promise<CodexCreateThreadServiceTierModel | null> {
  try {
    const response = await dependencies.listModels({
      hostId: input.hostId,
      includeHidden: true,
      cursor: null,
      limit: 100,
    });
    if (input.model === null) {
      return response.data.find((model) => model.isDefault) ?? null;
    }
    return (
      response.data.find((model) => model.model === input.model || model.id === input.model) ?? null
    );
  } catch (error) {
    dependencies.onError?.({ phase: "models", error });
    return null;
  }
}

export async function resolveCodexCreateThreadServiceTier(
  input: ResolveCodexCreateThreadServiceTierInput,
  dependencies: CodexCreateThreadServiceTierDependencies,
): Promise<string | null> {
  try {
    const fastModeEnabled = await readFastModeEnabled(input.destinationHostId, dependencies);
    const selector = input.selector ?? FROM_CONFIG_SERVICE_TIER_SELECTOR;
    if (selector.type !== "fromConfig") {
      return projectServiceTier(null, resolveSelectorServiceTier(selector), fastModeEnabled);
    }

    const config = expandCodexDynamicCreateConfigProfile(
      await dependencies.readConfig({
        hostId: input.destinationHostId,
        cwd: null,
        includeLayers: false,
      }),
    );
    const configuredServiceTier = config.service_tier ?? null;
    if (configuredServiceTier !== null) {
      return projectServiceTier(null, configuredServiceTier, fastModeEnabled);
    }

    const model = await readSelectedModel(
      {
        hostId: input.destinationHostId,
        model: input.model ?? config.model ?? null,
      },
      dependencies,
    );
    return projectServiceTier(model, null, fastModeEnabled);
  } catch (error) {
    dependencies.onError?.({ phase: "request", error });
    return null;
  }
}
