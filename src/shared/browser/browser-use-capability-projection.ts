import { z } from "zod";

export const BROWSER_USE_CAPABILITY_CONTRACT_VERSION = "1.0.0";

const MAX_CAPABILITY_ENTRIES = 512;
const MAX_REASONS = 64;
const MAX_IDENTIFIER_LENGTH = 160;

const BrowserUseBackendTypeSchema = z.enum(["extension", "iab", "cdp"]);
const BrowserUseBackendAvailabilityKeySchema = z.enum(["chrome", "iab", "cdp"]);
const BrowserUseIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/u);
const BrowserUsePolicyDecisionSchema = z.enum([
  "allow",
  "deny",
  "not-configured",
  "unverified",
]);

const BrowserUseApiMemberSchema = z.strictObject({
  id: BrowserUseIdentifierSchema,
  unsupportedByDefaultIn: z.array(BrowserUseBackendTypeSchema)
    .max(3)
    .default([]),
  requiresFullCdpAccess: z.boolean().default(false),
});

const BrowserUseCapabilityDescriptorSchema = z.strictObject({
  id: BrowserUseIdentifierSchema,
  description: z.string().max(2_048).optional(),
});
const BrowserUseBackendMetadataSchema = z.record(
  z.string().trim().min(1).max(128),
  z.string().max(2_048),
).refine((value) => Object.keys(value).length <= 64);

const CompatibleArtifactSchema = z.strictObject({
  status: z.literal("compatible"),
  contractVersion: z.string().trim().min(1).max(64),
  apiMembers: z.array(BrowserUseApiMemberSchema).max(MAX_CAPABILITY_ENTRIES),
  browserCapabilities: z.array(BrowserUseIdentifierSchema).max(MAX_CAPABILITY_ENTRIES),
  tabCapabilities: z.array(BrowserUseIdentifierSchema).max(MAX_CAPABILITY_ENTRIES),
});

const UnavailableArtifactSchema = z.strictObject({
  status: z.enum(["missing", "incompatible"]),
});

const BrowserUseArtifactProjectionSchema = z.discriminatedUnion("status", [
  CompatibleArtifactSchema,
  UnavailableArtifactSchema,
]);

const BrowserUseBackendInfoSchema = z.strictObject({
  id: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH),
  name: z.string().trim().min(1).max(512),
  type: BrowserUseBackendTypeSchema,
  apiSupportOverrides: z.record(
    BrowserUseIdentifierSchema,
    z.boolean(),
  )
    .refine((value) => Object.keys(value).length <= MAX_CAPABILITY_ENTRIES)
    .default({}),
  capabilities: z.strictObject({
    browser: z.array(BrowserUseCapabilityDescriptorSchema)
      .max(MAX_CAPABILITY_ENTRIES)
      .default([]),
    tab: z.array(BrowserUseCapabilityDescriptorSchema)
      .max(MAX_CAPABILITY_ENTRIES)
      .default([]),
  }),
  family: z.string().trim().min(1).max(128).optional(),
  metadata: BrowserUseBackendMetadataSchema.default({}),
  buildFlavor: z.string().trim().min(1).max(128).optional(),
  sessionId: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
});

const BrowserUseFullCdpPolicySchema = z.strictObject({
  fullCdpAccess: BrowserUsePolicyDecisionSchema,
});

const BrowserUsePluginPolicySchema = z.strictObject({
  local: BrowserUseFullCdpPolicySchema,
  enterprise: BrowserUseFullCdpPolicySchema,
  environment: BrowserUseFullCdpPolicySchema.extend({
    availableBackends: z.array(BrowserUseBackendAvailabilityKeySchema)
      .max(3)
      .optional(),
    disabledApiMembers: z.array(BrowserUseIdentifierSchema)
      .max(MAX_CAPABILITY_ENTRIES)
      .default([]),
    disabledBrowserCapabilities: z.array(BrowserUseIdentifierSchema)
      .max(MAX_CAPABILITY_ENTRIES)
      .default([]),
    disabledTabCapabilities: z.array(BrowserUseIdentifierSchema)
      .max(MAX_CAPABILITY_ENTRIES)
      .default([]),
  }),
});

export type BrowserUseBackendType = z.infer<typeof BrowserUseBackendTypeSchema>;
export type BrowserUsePolicyDecision = z.infer<typeof BrowserUsePolicyDecisionSchema>;
export type BrowserUseCompatibleArtifact = z.infer<typeof CompatibleArtifactSchema>;
export type BrowserUseBackendInfo = z.infer<typeof BrowserUseBackendInfoSchema>;
export type BrowserUsePluginPolicy = z.infer<typeof BrowserUsePluginPolicySchema>;

export type BrowserUseCapabilityReasonStage = "artifact" | "backend" | "plugin";
export type BrowserUseCapabilityTargetKind =
  | "runtime"
  | "api-member"
  | "browser-capability"
  | "tab-capability";

export type BrowserUseCapabilityReasonCode =
  | "artifact-invalid"
  | "artifact-missing"
  | "artifact-incompatible"
  | "artifact-contract-version-mismatch"
  | "backend-invalid"
  | "backend-unavailable"
  | "backend-api-unsupported"
  | "backend-capability-missing"
  | "backend-unknown-capability"
  | "plugin-invalid"
  | "plugin-api-disabled"
  | "plugin-capability-disabled"
  | "plugin-unknown-disable-target"
  | "full-cdp-local-disabled"
  | "full-cdp-local-unverified"
  | "full-cdp-enterprise-disabled"
  | "full-cdp-enterprise-unverified"
  | "full-cdp-environment-disabled"
  | "full-cdp-environment-unverified"
  | "reason-limit-reached";

export interface BrowserUseCapabilityReason {
  stage: BrowserUseCapabilityReasonStage;
  code: BrowserUseCapabilityReasonCode;
  targetKind: BrowserUseCapabilityTargetKind;
  targetId?: string;
  message: string;
}

export interface BrowserUseCapabilityProjectionInput {
  artifact: unknown;
  backend: unknown;
  plugin: unknown;
}

export interface BrowserUseEffectiveCapabilities {
  status: "available" | "unavailable";
  contractVersion: string | null;
  backend: {
    id: string;
    name: string;
    type: BrowserUseBackendType;
    family?: string;
    metadata: Readonly<Record<string, string>>;
    buildFlavor?: string;
    sessionId?: string;
  } | null;
  fullCdpAccess: boolean;
  apiMembers: readonly string[];
  browserCapabilities: readonly string[];
  tabCapabilities: readonly string[];
  disabledApiMembers: readonly string[];
  disabledBrowserCapabilities: readonly string[];
  disabledTabCapabilities: readonly string[];
  reasons: readonly BrowserUseCapabilityReason[];
}

interface ReasonCollector {
  add: (reason: BrowserUseCapabilityReason) => void;
  values: () => readonly BrowserUseCapabilityReason[];
}

function createReasonCollector(): ReasonCollector {
  const reasons: BrowserUseCapabilityReason[] = [];
  let didReachLimit = false;

  return {
    add(reason) {
      if (didReachLimit) return;
      if (reasons.length < MAX_REASONS - 1) {
        reasons.push(reason);
        return;
      }

      didReachLimit = true;
      reasons.push({
        stage: reason.stage,
        code: "reason-limit-reached",
        targetKind: "runtime",
        message: "Additional Browser Use capability reasons were omitted.",
      });
    },
    values: () => reasons,
  };
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function availabilityKeyForBackend(
  backendType: BrowserUseBackendType,
): z.infer<typeof BrowserUseBackendAvailabilityKeySchema> {
  return backendType === "extension" ? "chrome" : backendType;
}

function isPolicyDecisionAllowed(decision: BrowserUsePolicyDecision): boolean {
  return decision === "allow" || decision === "not-configured";
}

function fullCdpReasonFor(
  stage: "local" | "enterprise" | "environment",
  decision: BrowserUsePolicyDecision,
): BrowserUseCapabilityReason | null {
  if (isPolicyDecisionAllowed(decision)) return null;

  const isDisabled = decision === "deny";
  const codeByStage = {
    local: isDisabled
      ? "full-cdp-local-disabled"
      : "full-cdp-local-unverified",
    enterprise: isDisabled
      ? "full-cdp-enterprise-disabled"
      : "full-cdp-enterprise-unverified",
    environment: isDisabled
      ? "full-cdp-environment-disabled"
      : "full-cdp-environment-unverified",
  } as const;

  return {
    stage: "plugin",
    code: codeByStage[stage],
    targetKind: "runtime",
    message: `Full CDP access is ${isDisabled ? "disabled" : "unverified"} by ${stage} policy.`,
  };
}

function buildClosedProjection(
  artifact: BrowserUseCompatibleArtifact | null,
  reasons: readonly BrowserUseCapabilityReason[],
): BrowserUseEffectiveCapabilities {
  return {
    status: "unavailable",
    contractVersion: artifact?.contractVersion ?? null,
    backend: null,
    fullCdpAccess: false,
    apiMembers: [],
    browserCapabilities: [],
    tabCapabilities: [],
    disabledApiMembers: artifact?.apiMembers.map(({ id }) => id) ?? [],
    disabledBrowserCapabilities: artifact?.browserCapabilities ?? [],
    disabledTabCapabilities: artifact?.tabCapabilities ?? [],
    reasons,
  };
}

function projectCapabilityKind(input: {
  candidateIds: readonly string[];
  backendCapabilities: readonly z.infer<typeof BrowserUseCapabilityDescriptorSchema>[];
  pluginDisabledIds: readonly string[];
  targetKind: "browser-capability" | "tab-capability";
  reasons: ReasonCollector;
}): {
  enabled: string[];
  disabled: string[];
} {
  const candidateIds = new Set(input.candidateIds);
  const backendIds = new Set<string>();

  for (const { id } of input.backendCapabilities) {
    if (candidateIds.has(id)) {
      backendIds.add(id);
      continue;
    }

    input.reasons.add({
      stage: "backend",
      code: "backend-unknown-capability",
      targetKind: input.targetKind,
      targetId: id,
      message: "The backend advertised a capability absent from the compatible artifact.",
    });
  }

  const pluginDisabledIds = new Set<string>();
  for (const id of input.pluginDisabledIds) {
    if (candidateIds.has(id)) {
      pluginDisabledIds.add(id);
      continue;
    }

    input.reasons.add({
      stage: "plugin",
      code: "plugin-unknown-disable-target",
      targetKind: input.targetKind,
      targetId: id,
      message: "A plugin disable targeted a capability absent from the compatible artifact.",
    });
  }

  const enabled: string[] = [];
  const disabled: string[] = [];
  for (const id of input.candidateIds) {
    if (!backendIds.has(id)) {
      disabled.push(id);
      input.reasons.add({
        stage: "backend",
        code: "backend-capability-missing",
        targetKind: input.targetKind,
        targetId: id,
        message: "The backend did not advertise this capability.",
      });
      continue;
    }

    if (pluginDisabledIds.has(id)) {
      disabled.push(id);
      input.reasons.add({
        stage: "plugin",
        code: "plugin-capability-disabled",
        targetKind: input.targetKind,
        targetId: id,
        message: "The plugin environment disabled this capability.",
      });
      continue;
    }

    enabled.push(id);
  }

  return { enabled, disabled };
}

export function projectBrowserUseCapabilities(
  input: BrowserUseCapabilityProjectionInput,
): BrowserUseEffectiveCapabilities {
  const reasons = createReasonCollector();
  const artifactResult = BrowserUseArtifactProjectionSchema.safeParse(input.artifact);
  if (!artifactResult.success) {
    reasons.add({
      stage: "artifact",
      code: "artifact-invalid",
      targetKind: "runtime",
      message: "The Browser Use artifact capability manifest is invalid.",
    });
    return buildClosedProjection(null, reasons.values());
  }

  if (artifactResult.data.status !== "compatible") {
    const isMissing = artifactResult.data.status === "missing";
    reasons.add({
      stage: "artifact",
      code: isMissing ? "artifact-missing" : "artifact-incompatible",
      targetKind: "runtime",
      message: isMissing
        ? "The Browser Use runtime artifact is missing."
        : "The Browser Use runtime artifact is incompatible.",
    });
    return buildClosedProjection(null, reasons.values());
  }

  const artifact = artifactResult.data;
  if (artifact.contractVersion !== BROWSER_USE_CAPABILITY_CONTRACT_VERSION) {
    reasons.add({
      stage: "artifact",
      code: "artifact-contract-version-mismatch",
      targetKind: "runtime",
      message: "The Browser Use artifact capability contract version is incompatible.",
    });
    return buildClosedProjection(artifact, reasons.values());
  }

  const backendResult = BrowserUseBackendInfoSchema.safeParse(input.backend);
  if (!backendResult.success) {
    reasons.add({
      stage: "backend",
      code: "backend-invalid",
      targetKind: "runtime",
      message: "The Browser Use backend capability response is invalid.",
    });
    return buildClosedProjection(artifact, reasons.values());
  }

  const pluginResult = BrowserUsePluginPolicySchema.safeParse(input.plugin);
  if (!pluginResult.success) {
    reasons.add({
      stage: "plugin",
      code: "plugin-invalid",
      targetKind: "runtime",
      message: "The Browser Use plugin capability policy is invalid.",
    });
    return buildClosedProjection(artifact, reasons.values());
  }

  const backend = backendResult.data;
  const plugin = pluginResult.data;
  const availableBackends = plugin.environment.availableBackends;
  const backendAvailabilityKey = availabilityKeyForBackend(backend.type);
  if (availableBackends && !availableBackends.includes(backendAvailabilityKey)) {
    reasons.add({
      stage: "plugin",
      code: "backend-unavailable",
      targetKind: "runtime",
      message: "The selected Browser Use backend is unavailable in this environment.",
    });
    return buildClosedProjection(artifact, reasons.values());
  }

  const fullCdpReasons = [
    fullCdpReasonFor("local", plugin.local.fullCdpAccess),
    fullCdpReasonFor("enterprise", plugin.enterprise.fullCdpAccess),
    fullCdpReasonFor("environment", plugin.environment.fullCdpAccess),
  ].filter((reason): reason is BrowserUseCapabilityReason => reason !== null);
  for (const reason of fullCdpReasons) reasons.add(reason);
  const fullCdpAccess = fullCdpReasons.length === 0;

  const artifactApiMemberIds = new Set(
    artifact.apiMembers.map(({ id }) => id),
  );
  for (const id of Object.keys(backend.apiSupportOverrides)) {
    if (artifactApiMemberIds.has(id)) continue;
    reasons.add({
      stage: "backend",
      code: "backend-api-unsupported",
      targetKind: "api-member",
      targetId: id,
      message: "The backend override targeted an API member absent from the compatible artifact.",
    });
  }

  const pluginDisabledApiMembers = new Set<string>();
  for (const id of plugin.environment.disabledApiMembers) {
    if (artifactApiMemberIds.has(id)) {
      pluginDisabledApiMembers.add(id);
      continue;
    }

    reasons.add({
      stage: "plugin",
      code: "plugin-unknown-disable-target",
      targetKind: "api-member",
      targetId: id,
      message: "A plugin disable targeted an API member absent from the compatible artifact.",
    });
  }

  const apiMembers: string[] = [];
  const disabledApiMembers: string[] = [];
  for (const member of artifact.apiMembers) {
    const defaultSupported = !member.unsupportedByDefaultIn.includes(backend.type);
    const backendSupported = backend.apiSupportOverrides[member.id]
      ?? defaultSupported;
    if (!backendSupported) {
      disabledApiMembers.push(member.id);
      reasons.add({
        stage: "backend",
        code: "backend-api-unsupported",
        targetKind: "api-member",
        targetId: member.id,
        message: "The selected backend does not support this API member.",
      });
      continue;
    }

    if (member.requiresFullCdpAccess && !fullCdpAccess) {
      disabledApiMembers.push(member.id);
      continue;
    }

    if (pluginDisabledApiMembers.has(member.id)) {
      disabledApiMembers.push(member.id);
      reasons.add({
        stage: "plugin",
        code: "plugin-api-disabled",
        targetKind: "api-member",
        targetId: member.id,
        message: "The plugin environment disabled this API member.",
      });
      continue;
    }

    apiMembers.push(member.id);
  }

  const browserCapabilities = projectCapabilityKind({
    candidateIds: unique(artifact.browserCapabilities),
    backendCapabilities: backend.capabilities.browser,
    pluginDisabledIds: plugin.environment.disabledBrowserCapabilities,
    targetKind: "browser-capability",
    reasons,
  });
  const tabCapabilities = projectCapabilityKind({
    candidateIds: unique(artifact.tabCapabilities),
    backendCapabilities: backend.capabilities.tab,
    pluginDisabledIds: plugin.environment.disabledTabCapabilities,
    targetKind: "tab-capability",
    reasons,
  });

  return {
    status: "available",
    contractVersion: artifact.contractVersion,
    backend: {
      id: backend.id,
      name: backend.name,
      type: backend.type,
      metadata: backend.metadata,
      ...(backend.family ? { family: backend.family } : {}),
      ...(backend.buildFlavor ? { buildFlavor: backend.buildFlavor } : {}),
      ...(backend.sessionId ? { sessionId: backend.sessionId } : {}),
    },
    fullCdpAccess,
    apiMembers,
    browserCapabilities: browserCapabilities.enabled,
    tabCapabilities: tabCapabilities.enabled,
    disabledApiMembers,
    disabledBrowserCapabilities: browserCapabilities.disabled,
    disabledTabCapabilities: tabCapabilities.disabled,
    reasons: reasons.values(),
  };
}
