import * as path from "node:path";
import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import type { ConfigRequirements } from "@nodex/codex-app-server-protocol/v2/ConfigRequirements";
import type { ConfigEdit } from "@nodex/codex-app-server-protocol/v2/ConfigEdit";
import type { SandboxPolicy } from "@nodex/codex-app-server-protocol/v2/SandboxPolicy";
import type { SandboxWorkspaceWrite } from "@nodex/codex-app-server-protocol/v2/SandboxWorkspaceWrite";
import type {
  CodexApprovalPolicy,
  CodexApprovalsReviewer,
  CodexPermissionMode,
  CodexPermissionPreset,
  CodexPermissionState,
  CodexSandboxMode,
} from "../../shared/types";

const GUARDIAN_APPROVAL_FEATURE_KEY = "guardian_approval";
const APPROVALS_REVIEWER_KEY = "approvals_reviewer";
const DEFAULT_APPROVALS_REVIEWER: CodexApprovalsReviewer = "user";
const GUARDIAN_APPROVALS_REVIEWER: CodexApprovalsReviewer = "guardian_subagent";
const DEFAULT_CUSTOM_DESCRIPTION =
  "No project or user Codex config was found. Codex will fall back to its built-in permission defaults.";

interface ResolvedPreset {
  preset: CodexPermissionPreset;
  sandboxMode: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
  approvalsReviewer: CodexApprovalsReviewer;
}

interface PermissionConfigTarget {
  source: CodexPermissionState["configTarget"]["source"];
  filePath: string | null;
}

const READ_ONLY_PRESET: ResolvedPreset = {
  preset: "read-only",
  sandboxMode: "read-only",
  approvalPolicy: "on-request",
  approvalsReviewer: DEFAULT_APPROVALS_REVIEWER,
};

const AUTO_PRESET: ResolvedPreset = {
  preset: "auto",
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: DEFAULT_APPROVALS_REVIEWER,
};

const GUARDIAN_PRESET: ResolvedPreset = {
  preset: "guardian-approvals",
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: GUARDIAN_APPROVALS_REVIEWER,
};

const FULL_ACCESS_PRESET: ResolvedPreset = {
  preset: "full-access",
  sandboxMode: "danger-full-access",
  approvalPolicy: "never",
  approvalsReviewer: DEFAULT_APPROVALS_REVIEWER,
};

const INTERNAL_PRESETS: ResolvedPreset[] = [
  READ_ONLY_PRESET,
  AUTO_PRESET,
  GUARDIAN_PRESET,
  FULL_ACCESS_PRESET,
];

const VISIBLE_MODE_ORDER: CodexPermissionMode[] = [
  "auto",
  "guardian-approvals",
  "full-access",
  "custom",
];

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function resolveGuardianApprovalGate(config: ConfigReadResponse["config"]): boolean {
  const featuresValue = config.features;
  if (!featuresValue || typeof featuresValue !== "object" || Array.isArray(featuresValue)) {
    return false;
  }

  const record = featuresValue as Record<string, unknown>;
  const direct = record[GUARDIAN_APPROVAL_FEATURE_KEY];
  if (isBoolean(direct)) return direct;
  return false;
}

function normalizeApprovalsReviewer(
  reviewer: unknown,
  guardianApprovalEnabled: boolean,
): CodexApprovalsReviewer {
  if (reviewer !== GUARDIAN_APPROVALS_REVIEWER) return DEFAULT_APPROVALS_REVIEWER;
  return guardianApprovalEnabled ? GUARDIAN_APPROVALS_REVIEWER : DEFAULT_APPROVALS_REVIEWER;
}

function buildWorkspaceWriteSandboxPolicy(
  workspacePath: string,
  sandboxWorkspaceWrite: SandboxWorkspaceWrite | null | undefined,
): Extract<SandboxPolicy, { type: "workspaceWrite" }> {
  return {
    type: "workspaceWrite",
    writableRoots: [workspacePath],
    readOnlyAccess: {
      type: "fullAccess",
    },
    networkAccess: sandboxWorkspaceWrite?.network_access ?? false,
    excludeTmpdirEnvVar: sandboxWorkspaceWrite?.exclude_tmpdir_env_var ?? false,
    excludeSlashTmp: sandboxWorkspaceWrite?.exclude_slash_tmp ?? false,
  };
}

function buildSandboxPolicy(
  sandboxMode: CodexSandboxMode | null,
  workspacePath: string | null,
  sandboxWorkspaceWrite: SandboxWorkspaceWrite | null | undefined,
): SandboxPolicy | null {
  if (sandboxMode === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }

  if (sandboxMode === "read-only") {
    return {
      type: "readOnly",
      access: {
        type: "fullAccess",
      },
      networkAccess: sandboxWorkspaceWrite?.network_access ?? false,
    };
  }

  if (sandboxMode === "workspace-write" && workspacePath) {
    return buildWorkspaceWriteSandboxPolicy(workspacePath, sandboxWorkspaceWrite);
  }

  return null;
}

function isPresetAllowed(
  preset: ResolvedPreset,
  requirements: ConfigRequirements | null,
): boolean {
  const allowedApprovalPolicies = requirements?.allowedApprovalPolicies ?? null;
  if (allowedApprovalPolicies && !allowedApprovalPolicies.includes(preset.approvalPolicy)) {
    return false;
  }

  const allowedSandboxModes = requirements?.allowedSandboxModes ?? null;
  if (allowedSandboxModes && !allowedSandboxModes.includes(preset.sandboxMode)) {
    return false;
  }

  return true;
}

function listAvailablePresets(requirements: ConfigRequirements | null): ResolvedPreset[] {
  return INTERNAL_PRESETS.filter((preset) => isPresetAllowed(preset, requirements));
}

function listVisibleModes(
  requirements: ConfigRequirements | null,
  guardianApprovalEnabled: boolean,
): CodexPermissionMode[] {
  const availablePresets = listAvailablePresets(requirements);
  const modes = new Set<CodexPermissionMode>();

  for (const preset of availablePresets) {
    if (preset.preset === "read-only") continue;
    if (preset.preset === "guardian-approvals" && !guardianApprovalEnabled) continue;
    modes.add(preset.preset);
  }

  return VISIBLE_MODE_ORDER.filter((mode) => modes.has(mode));
}

function isRepresentableCustomState(
  sandboxMode: CodexSandboxMode | null,
  approvalPolicy: CodexApprovalPolicy | null,
  requirements: ConfigRequirements | null,
): boolean {
  if (!sandboxMode || !approvalPolicy) return false;

  const allowedApprovalPolicies = requirements?.allowedApprovalPolicies ?? null;
  if (allowedApprovalPolicies && !allowedApprovalPolicies.includes(approvalPolicy)) {
    return false;
  }

  const allowedSandboxModes = requirements?.allowedSandboxModes ?? null;
  if (allowedSandboxModes && !allowedSandboxModes.includes(sandboxMode)) {
    return false;
  }

  return true;
}

function resolvePresetFromEffectiveState(input: {
  sandboxMode: CodexSandboxMode | null;
  approvalPolicy: CodexApprovalPolicy | null;
  approvalsReviewer: CodexApprovalsReviewer;
}): CodexPermissionPreset | null {
  if (input.sandboxMode === "read-only" && input.approvalPolicy === "on-request") {
    return "read-only";
  }

  if (input.sandboxMode === "danger-full-access" && input.approvalPolicy === "never") {
    return "full-access";
  }

  if (input.sandboxMode === "workspace-write" && input.approvalPolicy === "on-request") {
    return input.approvalsReviewer === GUARDIAN_APPROVALS_REVIEWER ? "guardian-approvals" : "auto";
  }

  return null;
}

function resolveFallbackPreset(
  requirements: ConfigRequirements | null,
  guardianApprovalEnabled: boolean,
): ResolvedPreset {
  const availablePresets = listAvailablePresets(requirements);
  const preferredOrder: CodexPermissionPreset[] = guardianApprovalEnabled
    ? ["auto", "guardian-approvals", "full-access", "read-only"]
    : ["auto", "full-access", "read-only"];

  for (const presetName of preferredOrder) {
    const preset = availablePresets.find((candidate) => candidate.preset === presetName);
    if (preset) return preset;
  }

  return AUTO_PRESET;
}

function describeSource(target: PermissionConfigTarget): string {
  if (target.source === "project") return "Project config";
  if (target.source === "user") return "User config";
  return "Codex config";
}

function displayPath(target: PermissionConfigTarget): string {
  if (!target.filePath) return "config.toml";
  return target.filePath;
}

function buildCustomDescription(input: {
  target: PermissionConfigTarget;
  sandboxMode: CodexSandboxMode | null;
  approvalPolicy: CodexApprovalPolicy | null;
  approvalsReviewer: CodexApprovalsReviewer;
}): string {
  if (input.target.source === "none") {
    return DEFAULT_CUSTOM_DESCRIPTION;
  }

  const sourceLabel = describeSource(input.target);
  const pathLabel = displayPath(input.target);
  const sandboxLabel = input.sandboxMode ?? "unset";
  const approvalLabel = input.approvalPolicy ?? "unset";
  const reviewerLabel = input.approvalsReviewer ?? DEFAULT_APPROVALS_REVIEWER;

  return `${sourceLabel} (${pathLabel}): sandbox_mode=${sandboxLabel}; approval_policy=${approvalLabel}; ${APPROVALS_REVIEWER_KEY}=${reviewerLabel}.`;
}

function resolveConfigTarget(input: {
  origins: ConfigReadResponse["origins"];
  defaultUserConfigPath: string;
}): PermissionConfigTarget {
  const originKeys = [
    "approval_policy",
    "sandbox_mode",
    APPROVALS_REVIEWER_KEY,
    "sandbox_workspace_write",
  ];

  for (const key of originKeys) {
    const origin = input.origins[key];
    const source = origin?.name;
    if (!source) continue;

    if (source.type === "project") {
      return {
        source: "project",
        filePath: path.join(source.dotCodexFolder, "config.toml"),
      };
    }

    if (source.type === "user") {
      return {
        source: "user",
        filePath: source.file,
      };
    }
  }

  return {
    source: "user",
    filePath: input.defaultUserConfigPath,
  };
}

export function resolveCodexPermissionState(input: {
  config: ConfigReadResponse["config"];
  origins: ConfigReadResponse["origins"];
  requirements: ConfigRequirements | null;
  defaultUserConfigPath: string;
  workspacePath: string | null;
}): CodexPermissionState {
  const guardianApprovalEnabled = resolveGuardianApprovalGate(input.config);
  const sandboxMode = input.config.sandbox_mode ?? null;
  const approvalPolicy = input.config.approval_policy ?? null;
  const approvalsReviewer = normalizeApprovalsReviewer(
    input.config.approvals_reviewer,
    guardianApprovalEnabled,
  );
  const availableModes = listVisibleModes(input.requirements, guardianApprovalEnabled);
  const matchedPreset = resolvePresetFromEffectiveState({
    sandboxMode,
    approvalPolicy,
    approvalsReviewer,
  });
  const configTarget = resolveConfigTarget({
    origins: input.origins,
    defaultUserConfigPath: input.defaultUserConfigPath,
  });
  const explicitKeys = input.origins.approval_policy || input.origins.sandbox_mode;
  const isCustom = Boolean(explicitKeys) && isRepresentableCustomState(
    sandboxMode,
    approvalPolicy,
    input.requirements,
  );
  const fallbackPreset = resolveFallbackPreset(input.requirements, guardianApprovalEnabled);
  const effectivePreset = isCustom
    ? "custom"
    : (matchedPreset && isPresetAllowed(
      INTERNAL_PRESETS.find((preset) => preset.preset === matchedPreset) ?? fallbackPreset,
      input.requirements,
    )
      ? matchedPreset
      : fallbackPreset.preset);

  const visibleMode: CodexPermissionMode = isCustom
    ? "custom"
    : effectivePreset === "read-only"
      ? "custom"
      : effectivePreset;
  const nextAvailableModes: CodexPermissionMode[] = isCustom && !availableModes.includes("custom")
    ? [...availableModes, "custom"]
    : availableModes;

  return {
    mode: visibleMode,
    effectivePreset,
    availableModes: nextAvailableModes,
    approvalPolicy,
    approvalsReviewer,
    sandboxMode,
    sandbox: buildSandboxPolicy(sandboxMode, input.workspacePath, input.config.sandbox_workspace_write),
    guardianApprovalEnabled,
    configTarget,
    customDescription: buildCustomDescription({
      target: configTarget,
      sandboxMode,
      approvalPolicy,
      approvalsReviewer,
    }),
  };
}

export function buildPermissionModeConfigEdits(mode: CodexPermissionMode): ConfigEdit[] {
  if (mode === "custom") {
    return [];
  }

  const preset = mode === "guardian-approvals"
    ? GUARDIAN_PRESET
    : mode === "full-access"
      ? FULL_ACCESS_PRESET
      : AUTO_PRESET;

  return [
    {
      keyPath: "sandbox_mode",
      value: preset.sandboxMode,
      mergeStrategy: "replace",
    },
    {
      keyPath: "approval_policy",
      value: preset.approvalPolicy,
      mergeStrategy: "replace",
    },
    {
      keyPath: APPROVALS_REVIEWER_KEY,
      value: preset.approvalsReviewer,
      mergeStrategy: "replace",
    },
  ];
}

export function buildTurnPermissionOverrides(input: {
  permissionState: CodexPermissionState;
  workspacePath: string | null;
}): {
  approvalPolicy?: CodexApprovalPolicy;
  approvalsReviewer?: CodexApprovalsReviewer;
  sandboxPolicy?: SandboxPolicy;
} {
  if (input.permissionState.effectivePreset === "custom") {
    return {};
  }

  const sandboxPolicy = buildSandboxPolicy(
    input.permissionState.sandboxMode,
    input.workspacePath,
    {
      writable_roots: input.workspacePath ? [input.workspacePath] : [],
      network_access: input.permissionState.sandbox?.type === "workspaceWrite"
        ? input.permissionState.sandbox.networkAccess
        : false,
      exclude_tmpdir_env_var: input.permissionState.sandbox?.type === "workspaceWrite"
        ? input.permissionState.sandbox.excludeTmpdirEnvVar
        : false,
      exclude_slash_tmp: input.permissionState.sandbox?.type === "workspaceWrite"
        ? input.permissionState.sandbox.excludeSlashTmp
        : false,
    },
  );

  return {
    ...(input.permissionState.approvalPolicy ? { approvalPolicy: input.permissionState.approvalPolicy } : {}),
    approvalsReviewer: input.permissionState.approvalsReviewer,
    ...(sandboxPolicy ? { sandboxPolicy } : {}),
  };
}

export function buildThreadPermissionOverrides(input: {
  permissionState: CodexPermissionState;
}): {
  approvalPolicy?: CodexApprovalPolicy;
  approvalsReviewer?: CodexApprovalsReviewer;
  sandbox?: CodexSandboxMode;
} {
  if (input.permissionState.effectivePreset === "custom") {
    return {};
  }

  return {
    ...(input.permissionState.approvalPolicy ? { approvalPolicy: input.permissionState.approvalPolicy } : {}),
    approvalsReviewer: input.permissionState.approvalsReviewer,
    ...(input.permissionState.sandboxMode ? { sandbox: input.permissionState.sandboxMode } : {}),
  };
}
