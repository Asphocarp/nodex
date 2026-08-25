export type DictationSurface = "composer" | "global";
export type DictationGesture = "click" | "hold" | "toggle" | "retry";
export type DictationStopAction = "insert" | "send" | "abort";
export type DictationStopReason =
  | "user"
  | "max-duration"
  | "too-short"
  | "no-audio"
  | "capture-interrupted";

export type DictationOperation =
  | "permission"
  | "capture"
  | "stream"
  | "transcribe"
  | "history"
  | "paste";

export type DictationErrorKind =
  | "microphone-permission-denied"
  | "microphone-restricted"
  | "microphone-not-found"
  | "microphone-busy"
  | "constraint-unsatisfied"
  | "capture-unsupported"
  | "capture-interrupted"
  | "transcription-network"
  | "transcription-rate-limited"
  | "transcription-auth"
  | "transcription-service"
  | "history-unavailable"
  | "accessibility-denied"
  | "paste-failed"
  | "unknown";

/** Safe, stable diagnostics only. User speech, device labels, and raw error messages do not belong here. */
export interface DictationError {
  readonly kind: DictationErrorKind;
  readonly retryable: boolean;
  readonly operation: DictationOperation;
  readonly status?: number;
  readonly nativeName?: string;
}

export type MicrophoneAccessStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unavailable"
  | "unknown";

export type MicrophoneAccessResult =
  | { readonly kind: "granted"; readonly status: "granted" }
  | {
      readonly kind: "blocked";
      readonly status: "denied" | "restricted";
      readonly restartRequired: boolean;
    }
  | {
      readonly kind: "unavailable";
      readonly status: "unavailable" | "unknown";
    }
  | { readonly kind: "failed"; readonly error: DictationError };

export interface DictationCapabilitySnapshot {
  readonly composer: boolean;
  readonly global: boolean;
  readonly history: boolean;
  readonly streaming: "available" | "unavailable" | "unknown";
  readonly semanticCleanup: boolean;
  readonly microphoneOwner: "none" | "dictation" | "realtime-voice";
  readonly auth: "chatgpt" | "unsupported";
}

export interface GlobalDictationPermissionSnapshot {
  readonly available: boolean;
  readonly inputMonitoring: boolean;
  readonly accessibility: boolean;
}

export interface DictationSettings {
  readonly microphoneInputDeviceId: string | null;
  readonly keepGlobalBarVisible: boolean;
  readonly playStartSound: boolean;
  readonly playStopSound: boolean;
  readonly globalShortcutNudgeDismissed: boolean;
  readonly dictionary: readonly string[];
}

export type DictationSettingsPatch = Partial<DictationSettings>;

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  microphoneInputDeviceId: null,
  keepGlobalBarVisible: false,
  playStartSound: true,
  playStopSound: true,
  globalShortcutNudgeDismissed: false,
  dictionary: [],
};
