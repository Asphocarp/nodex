import type {
  DictationError,
  MicrophoneAccessResult,
  MicrophoneAccessStatus,
} from "../../shared/dictation";

export type HostMicrophoneAccessStatus =
  | "denied"
  | "granted"
  | "not-determined"
  | "restricted"
  | "unknown";

export interface SystemMicrophonePermissionAdapter {
  readonly platform: NodeJS.Platform;
  readonly systemPreferences: {
    readonly askForMediaAccess: (mediaType: "microphone") => Promise<boolean>;
    readonly getMediaAccessStatus: (mediaType: "microphone") => HostMicrophoneAccessStatus;
  };
}

export interface SystemMicrophonePermissionService {
  readonly readStatus: () => MicrophoneAccessStatus;
  readonly requestAccess: () => Promise<MicrophoneAccessResult>;
}

type StatusReadResult =
  | { readonly ok: true; readonly status: HostMicrophoneAccessStatus }
  | { readonly ok: false };

const permissionFailure = (nativeName: string): MicrophoneAccessResult => ({
  kind: "failed",
  error: {
    kind: "unknown",
    operation: "permission",
    retryable: true,
    nativeName,
  } satisfies DictationError,
});

function readHostStatus(
  systemPreferences: SystemMicrophonePermissionAdapter["systemPreferences"],
): StatusReadResult {
  try {
    return {
      ok: true,
      status: systemPreferences.getMediaAccessStatus("microphone"),
    };
  } catch {
    return { ok: false };
  }
}

function resolveKnownStatus(
  status: Exclude<HostMicrophoneAccessStatus, "not-determined">,
): MicrophoneAccessResult {
  if (status === "granted") return { kind: "granted", status };
  if (status === "denied" || status === "restricted") {
    return { kind: "blocked", restartRequired: true, status };
  }
  return { kind: "unavailable", status: "unknown" };
}

/** Owns the macOS TCC state transition without trusting the prompt's boolean result. */
export function createSystemMicrophonePermissionService(
  adapter: SystemMicrophonePermissionAdapter,
): SystemMicrophonePermissionService {
  const readStatus = (): MicrophoneAccessStatus => {
    if (adapter.platform !== "darwin") return "unavailable";
    const result = readHostStatus(adapter.systemPreferences);
    return result.ok ? result.status : "unknown";
  };

  const requestAccess = async (): Promise<MicrophoneAccessResult> => {
    if (adapter.platform !== "darwin") {
      return { kind: "unavailable", status: "unavailable" };
    }

    const current = readHostStatus(adapter.systemPreferences);
    if (!current.ok) {
      return permissionFailure("StatusReadFailed");
    }
    if (current.status !== "not-determined") return resolveKnownStatus(current.status);

    try {
      await adapter.systemPreferences.askForMediaAccess("microphone");
    } catch {
      return permissionFailure("RequestFailed");
    }

    const resolved = readHostStatus(adapter.systemPreferences);
    if (!resolved.ok) {
      return permissionFailure("StatusReadFailed");
    }
    if (resolved.status === "not-determined") {
      return permissionFailure("StatusUnresolved");
    }
    return resolveKnownStatus(resolved.status);
  };

  return { readStatus, requestAccess };
}
