export type CodexThreadHandoffCapabilityUnavailableReason =
  | "app-server-version-unsupported"
  | "app-server-settings-update-unavailable"
  | "app-server-resume-location-unavailable"
  | "app-server-rollout-consistency-unavailable"
  | "core-atomic-location-unavailable"
  | "source-host-unavailable"
  | "destination-host-unavailable"
  | "host-transaction-unavailable"
  | "cross-host-transfer-unavailable";

export type CodexThreadHandoffCapability =
  | {
      readonly status: "available";
      readonly mode: "local" | "cross-host";
    }
  | {
      readonly status: "unavailable";
      readonly mode: "local" | "cross-host";
      readonly reasons: readonly CodexThreadHandoffCapabilityUnavailableReason[];
    };

export interface CodexThreadHandoffCapabilityInput {
  readonly runtimeVersion: string | null;
  readonly appServer: {
    readonly threadSettingsUpdate: boolean;
    readonly threadResumeLocation: boolean;
    readonly rolloutPathConsistency: boolean;
  };
  readonly coreAtomicExecutionLocation: boolean;
  readonly sourceHost: {
    readonly available: boolean;
    readonly transactionEffects: boolean;
  };
  readonly destinationHost: {
    readonly available: boolean;
    readonly transactionEffects: boolean;
  };
  readonly crossHost: boolean;
  readonly crossHostTransfer: boolean;
}

const MINIMUM_HANDOFF_RUNTIME_VERSION = [0, 146, 0] as const;

function parseRuntimeVersion(value: string | null): readonly [number, number, number] | null {
  if (!value) return null;
  const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:[-+\s]|$)/u.exec(value.trim());
  if (!match) return null;
  const parsed = match.slice(1, 4).map(Number);
  if (parsed.some((part) => !Number.isSafeInteger(part) || part < 0)) return null;
  return parsed as unknown as readonly [number, number, number];
}

export function supportsCodexThreadHandoffRuntimeVersion(value: string | null): boolean {
  const parsed = parseRuntimeVersion(value);
  if (!parsed) return false;
  for (let index = 0; index < MINIMUM_HANDOFF_RUNTIME_VERSION.length; index += 1) {
    if (parsed[index]! > MINIMUM_HANDOFF_RUNTIME_VERSION[index]!) return true;
    if (parsed[index]! < MINIMUM_HANDOFF_RUNTIME_VERSION[index]!) return false;
  }
  return true;
}

/** Fail-closed capability projection used by both tool registration and execution. */
export function evaluateCodexThreadHandoffCapability(
  input: CodexThreadHandoffCapabilityInput,
): CodexThreadHandoffCapability {
  const reasons: CodexThreadHandoffCapabilityUnavailableReason[] = [];
  if (!supportsCodexThreadHandoffRuntimeVersion(input.runtimeVersion)) {
    reasons.push("app-server-version-unsupported");
  }
  if (!input.appServer.threadSettingsUpdate) {
    reasons.push("app-server-settings-update-unavailable");
  }
  if (!input.appServer.threadResumeLocation) {
    reasons.push("app-server-resume-location-unavailable");
  }
  if (!input.appServer.rolloutPathConsistency) {
    reasons.push("app-server-rollout-consistency-unavailable");
  }
  if (!input.coreAtomicExecutionLocation) {
    reasons.push("core-atomic-location-unavailable");
  }
  if (!input.sourceHost.available) reasons.push("source-host-unavailable");
  if (!input.destinationHost.available) reasons.push("destination-host-unavailable");
  if (!input.sourceHost.transactionEffects || !input.destinationHost.transactionEffects) {
    reasons.push("host-transaction-unavailable");
  }
  if (input.crossHost && !input.crossHostTransfer) {
    reasons.push("cross-host-transfer-unavailable");
  }

  const mode = input.crossHost ? "cross-host" : "local";
  return reasons.length === 0
    ? { status: "available", mode }
    : { status: "unavailable", mode, reasons };
}
