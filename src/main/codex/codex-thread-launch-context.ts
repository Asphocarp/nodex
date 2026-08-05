import type { ConfigRequirementsReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigRequirementsReadResponse";
import type { DynamicToolSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolSpec";
import type { ThreadStartParams } from "@nodex/codex-app-server-protocol/v2/ThreadStartParams";
import type { AgentExecutionProfile } from "../../shared/agent-runtime";

export const CODEX_DYNAMIC_TOOLS_THREAD_START_TIMEOUT_MS = 5_000;

const DEFAULT_FEATURE_CONFIG_EXCLUSIONS = new Set([
  "auth_elicitation",
  "memories",
  "plugins",
  "apps",
  "tool_suggest",
  "tool_call_mcp_elicitation",
  "writing_blocks",
]);

export type CodexThreadLaunchConfig = NonNullable<ThreadStartParams["config"]>;

export type CodexLaunchPermissionParams = Partial<Pick<
  ThreadStartParams,
  "approvalPolicy" | "approvalsReviewer" | "sandbox" | "permissions" | "runtimeWorkspaceRoots"
>>;

export interface CodexStoredShellEnvironment {
  readonly version: 1;
  readonly set: Readonly<Record<string, string>>;
  readonly exclude: readonly string[];
}

interface CodexShellEnvironmentPolicy {
  readonly inherit?: string;
  readonly include_only?: readonly string[];
  readonly ignore_default_excludes?: boolean;
  readonly experimental_use_profile?: boolean;
  readonly exclude?: readonly string[];
  readonly set?: Readonly<Record<string, string>>;
}

export interface CodexThreadLaunchContextDependencies {
  readonly readConfigRequirements: () => Promise<ConfigRequirementsReadResponse>;
  readonly resolveModelProviderConfig?: () => Promise<{
    readonly modelProvider: string;
    readonly config: CodexThreadLaunchConfig;
  } | null>;
  readonly buildMcpCodexConfig: (
    cwd: string | null,
  ) => Promise<CodexThreadLaunchConfig | null>;
  readonly readWorktreeShellEnvironment?: (
    cwd: string,
  ) => Promise<CodexStoredShellEnvironment | null>;
  readonly readEffectiveConfig?: (
    cwd: string,
  ) => Promise<CodexThreadLaunchConfig>;
  readonly loadDynamicTools: (input: {
    readonly featureOverrides: CodexThreadLaunchConfig | null;
    readonly mode: string;
    readonly threadStartKind: string;
  }) => Promise<DynamicToolSpec[]>;
  readonly resolveDeveloperInstructions: (input: {
    readonly baseInstructions: string | null;
    readonly cwd: string;
    readonly model: string | null;
    readonly threadId: string | null;
    readonly threadToolsEnabled: boolean;
  }) => Promise<string>;
  readonly onConfigRequirementsError?: (error: unknown) => void;
  readonly onShellEnvironmentError?: (error: unknown) => void;
  readonly scheduleTimeout?: (
    callback: () => void,
    timeoutMs: number,
  ) => ReturnType<typeof setTimeout>;
  readonly cancelTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface BuildCodexNewConversationParamsInput {
  readonly model: string | null;
  readonly executionProfile?: AgentExecutionProfile | null;
  readonly serviceTier: string | null;
  readonly serviceName?: string;
  readonly cwd: string;
  readonly permissions: CodexLaunchPermissionParams | null;
  readonly defaultFeatureOverrides: CodexThreadLaunchConfig | null;
  readonly personality: ThreadStartParams["personality"];
  readonly baseInstructions?: string | null;
  readonly additionalDeveloperInstructions?: string | null;
  readonly includeDeveloperInstructions?: boolean;
  readonly isEverydayWorkMode?: boolean;
  readonly mode?: string;
  readonly skipDynamicTools?: boolean;
  readonly threadId?: string | null;
  readonly threadSource?: ThreadStartParams["threadSource"];
  readonly threadStartKind?: string;
  readonly writingBlocksDeveloperInstructions?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string"),
  );
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function parseCodexStoredShellEnvironment(
  value: unknown,
): CodexStoredShellEnvironment | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (!isRecord(value.set) || !Array.isArray(value.exclude)) return null;

  const set = stringRecord(value.set);
  if (Object.keys(set).length !== Object.keys(value.set).length) return null;
  const exclude = stringArray(value.exclude);
  if (exclude.length !== value.exclude.length) return null;

  return { version: 1, set, exclude };
}

function readCodexShellEnvironmentPolicy(
  config: CodexThreadLaunchConfig | null | undefined,
): CodexShellEnvironmentPolicy | null {
  if (!config) return null;
  const nested = config.shell_environment_policy;
  if (isRecord(nested)) return nested as CodexShellEnvironmentPolicy;

  const policy: CodexShellEnvironmentPolicy = {
    ...(typeof config["shell_environment_policy.inherit"] === "string"
      ? { inherit: config["shell_environment_policy.inherit"] }
      : {}),
    ...(Array.isArray(config["shell_environment_policy.include_only"])
      ? { include_only: stringArray(config["shell_environment_policy.include_only"]) }
      : {}),
    ...(typeof config["shell_environment_policy.ignore_default_excludes"] === "boolean"
      ? { ignore_default_excludes: config["shell_environment_policy.ignore_default_excludes"] }
      : {}),
    ...(typeof config["shell_environment_policy.experimental_use_profile"] === "boolean"
      ? { experimental_use_profile: config["shell_environment_policy.experimental_use_profile"] }
      : {}),
    ...(Array.isArray(config["shell_environment_policy.exclude"])
      ? { exclude: stringArray(config["shell_environment_policy.exclude"]) }
      : {}),
    ...(isRecord(config["shell_environment_policy.set"])
      ? { set: stringRecord(config["shell_environment_policy.set"]) }
      : {}),
  };
  return Object.keys(policy).length === 0 ? null : policy;
}

function mergeCodexShellEnvironmentPolicy(
  base: CodexShellEnvironmentPolicy,
  stored: CodexStoredShellEnvironment,
): CodexShellEnvironmentPolicy {
  const set = { ...stringRecord(base.set) };
  const excluded = new Set([...stringArray(base.exclude), ...stored.exclude]);

  for (const key of excluded) delete set[key];
  for (const [key, value] of Object.entries(stored.set)) {
    set[key] = value;
    excluded.delete(key);
  }

  return {
    ...base,
    set,
    exclude: [...excluded],
  };
}

function serializeCodexShellEnvironmentPolicy(
  policy: CodexShellEnvironmentPolicy,
): CodexThreadLaunchConfig {
  return {
    ...(typeof policy.inherit === "string"
      ? { "shell_environment_policy.inherit": policy.inherit }
      : {}),
    ...(Array.isArray(policy.include_only)
      ? { "shell_environment_policy.include_only": [...policy.include_only] }
      : {}),
    ...(typeof policy.ignore_default_excludes === "boolean"
      ? { "shell_environment_policy.ignore_default_excludes": policy.ignore_default_excludes }
      : {}),
    ...(typeof policy.experimental_use_profile === "boolean"
      ? { "shell_environment_policy.experimental_use_profile": policy.experimental_use_profile }
      : {}),
    ...(Array.isArray(policy.exclude)
      ? { "shell_environment_policy.exclude": [...policy.exclude] }
      : {}),
    ...(policy.set
      ? { "shell_environment_policy.set": { ...policy.set } }
      : {}),
  };
}

export function mergeCodexDefaultFeatureOverrides(
  params: ThreadStartParams,
  overrides: CodexThreadLaunchConfig | null,
): ThreadStartParams {
  if (!overrides || Object.keys(overrides).length === 0) return params;

  const featureConfig: CodexThreadLaunchConfig = {};
  for (const [rawKey, value] of Object.entries(overrides)) {
    const key = rawKey.startsWith("features.") ? rawKey.slice("features.".length) : rawKey;
    if (DEFAULT_FEATURE_CONFIG_EXCLUSIONS.has(key)) continue;
    featureConfig[`features.${key}`] = value;
  }

  return {
    ...params,
    config: {
      ...params.config,
      ...featureConfig,
    },
  };
}

export async function resolveCodexLaunchServiceTier(
  requestedServiceTier: string | null,
  dependencies: Pick<
    CodexThreadLaunchContextDependencies,
    "readConfigRequirements" | "onConfigRequirementsError"
  >,
): Promise<string | null> {
  if (requestedServiceTier === null) return null;

  try {
    const response = await dependencies.readConfigRequirements();
    if (response.requirements?.featureRequirements?.fast_mode === false) return null;
    return requestedServiceTier;
  } catch (error) {
    dependencies.onConfigRequirementsError?.(error);
    return null;
  }
}

async function applyCodexWorktreeShellEnvironment(
  params: ThreadStartParams,
  cwd: string,
  dependencies: CodexThreadLaunchContextDependencies,
): Promise<ThreadStartParams> {
  if (!dependencies.readWorktreeShellEnvironment) return params;

  try {
    const stored = await dependencies.readWorktreeShellEnvironment(cwd);
    if (!stored) return params;

    const currentConfig = params.config ?? {};
    const effectiveConfig = readCodexShellEnvironmentPolicy(currentConfig)
      ? null
      : await dependencies.readEffectiveConfig?.(cwd) ?? null;
    const basePolicy = readCodexShellEnvironmentPolicy(currentConfig)
      ?? readCodexShellEnvironmentPolicy(effectiveConfig)
      ?? { inherit: "all" };
    const mergedPolicy = mergeCodexShellEnvironmentPolicy(basePolicy, stored);
    const config = { ...currentConfig };
    delete config.shell_environment_policy;

    return {
      ...params,
      config: {
        ...config,
        ...serializeCodexShellEnvironmentPolicy(mergedPolicy),
      },
    };
  } catch (error) {
    dependencies.onShellEnvironmentError?.(error);
    return params;
  }
}

export function loadCodexDynamicToolsWithTimeout(
  load: () => Promise<DynamicToolSpec[]>,
  options: Pick<
    CodexThreadLaunchContextDependencies,
    "scheduleTimeout" | "cancelTimeout"
  > = {},
): Promise<DynamicToolSpec[]> {
  const scheduleTimeout = options.scheduleTimeout ?? setTimeout;
  const cancelTimeout = options.cancelTimeout ?? clearTimeout;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = scheduleTimeout(() => {
      if (settled) return;
      settled = true;
      resolve([]);
    }, CODEX_DYNAMIC_TOOLS_THREAD_START_TIMEOUT_MS);

    void load().then(
      (tools) => {
        if (settled) return;
        settled = true;
        cancelTimeout(timeout);
        resolve(tools);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cancelTimeout(timeout);
        reject(error);
      },
    );
  });
}

export async function buildCodexNewConversationParams(
  input: BuildCodexNewConversationParamsInput,
  dependencies: CodexThreadLaunchContextDependencies,
): Promise<ThreadStartParams> {
  const profile = input.executionProfile ?? null;
  const requestedServiceTier = profile?.serviceTier ?? input.serviceTier;
  const serviceTier = profile && profile.providerId !== "openai"
    ? requestedServiceTier
    : await resolveCodexLaunchServiceTier(requestedServiceTier, dependencies);
  const provider = await dependencies.resolveModelProviderConfig?.() ?? null;
  const mcpConfig = await dependencies.buildMcpCodexConfig(input.cwd);
  const model = profile?.modelId ?? input.model;
  const permissions = input.permissions;
  let params: ThreadStartParams = {
    cwd: input.cwd,
    model,
    modelProvider: profile?.providerId ?? provider?.modelProvider ?? null,
    serviceTier,
    ...(input.serviceName === undefined ? {} : { serviceName: input.serviceName }),
    config: {
      ...(provider?.config ?? {}),
      ...(mcpConfig ?? {}),
      ...(profile?.harnessId ? { harness: profile.harnessId } : {}),
      ...(profile?.reasoningEffort
        ? { model_reasoning_effort: profile.reasoningEffort }
        : {}),
    },
    ...(permissions?.approvalsReviewer == null
      ? {}
      : { approvalsReviewer: permissions.approvalsReviewer }),
    ...(permissions === null
      ? {}
      : {
          ...(hasOwn(permissions, "approvalPolicy")
            ? { approvalPolicy: permissions.approvalPolicy }
            : {}),
          ...(permissions.permissions == null
            ? hasOwn(permissions, "sandbox")
              ? { sandbox: permissions.sandbox }
              : {}
            : {
                permissions: permissions.permissions,
                ...(permissions.runtimeWorkspaceRoots === undefined
                  ? {}
                  : { runtimeWorkspaceRoots: permissions.runtimeWorkspaceRoots }),
              }),
        }),
    personality: input.personality ?? null,
    ephemeral: null,
    baseInstructions: input.baseInstructions ?? null,
    threadSource: input.threadSource === undefined ? "user" : input.threadSource,
    mockExperimentalField: null,
    experimentalRawEvents: false,
    dynamicTools: null,
  };

  params = mergeCodexDefaultFeatureOverrides(params, input.defaultFeatureOverrides);
  params = await applyCodexWorktreeShellEnvironment(params, input.cwd, dependencies);

  if (!input.skipDynamicTools) {
    params = {
      ...params,
      dynamicTools: await loadCodexDynamicToolsWithTimeout(
        () => dependencies.loadDynamicTools({
          featureOverrides: input.defaultFeatureOverrides,
          mode: input.mode ?? "default",
          threadStartKind: input.threadStartKind ?? "default",
        }),
        dependencies,
      ),
    };
  }

  if (input.includeDeveloperInstructions !== false) {
    params = {
      ...params,
      developerInstructions: await dependencies.resolveDeveloperInstructions({
        baseInstructions: params.developerInstructions ?? null,
        cwd: params.cwd ?? input.cwd,
        model,
        threadId: input.threadId ?? null,
        threadToolsEnabled: input.defaultFeatureOverrides?.thread_tools === true,
      }),
    };
  }

  if (
    input.includeDeveloperInstructions !== false
    && input.defaultFeatureOverrides?.writing_blocks === true
    && input.isEverydayWorkMode === true
    && input.writingBlocksDeveloperInstructions
  ) {
    params = {
      ...params,
      developerInstructions: params.developerInstructions
        ? `${params.developerInstructions}\n\n${input.writingBlocksDeveloperInstructions}`
        : input.writingBlocksDeveloperInstructions,
    };
  }

  if (input.additionalDeveloperInstructions !== null
    && input.additionalDeveloperInstructions !== undefined) {
    params = {
      ...params,
      developerInstructions: params.developerInstructions
        ? `${params.developerInstructions}\n\n${input.additionalDeveloperInstructions}`
        : input.additionalDeveloperInstructions,
    };
  }

  if (
    permissions === null
    || (typeof permissions.approvalPolicy === "object"
      && permissions.approvalPolicy !== null
      && "granular" in permissions.approvalPolicy)
  ) {
    params = {
      ...params,
      config: {
        ...params.config,
        "features.request_permissions_tool": true,
      },
    };
  }

  return params;
}
