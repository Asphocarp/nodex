import type { DictationError, DictationGesture } from "./dictation";

export const GLOBAL_DICTATION_COMMAND_CHANNEL = "global-dictation:command";

export interface GlobalDictationTarget {
  readonly pid: number;
  readonly bundleIdentifier: string;
}

export type GlobalDictationRendererCommand =
  | {
      readonly type: "start";
      readonly sessionId: string;
      readonly gesture: Extract<DictationGesture, "hold" | "toggle">;
    }
  | { readonly type: "stop"; readonly sessionId: string }
  | { readonly type: "cancel"; readonly sessionId: string }
  | { readonly type: "finish"; readonly sessionId: string }
  | { readonly type: "paste-failed"; readonly sessionId: string; readonly error: DictationError };

export type GlobalDictationRendererEvent =
  | { readonly type: "ready" }
  | { readonly type: "accepted"; readonly sessionId: string }
  | {
      readonly type: "state";
      readonly sessionId: string;
      readonly state: "listening" | "transcribing";
    }
  | { readonly type: "completed"; readonly sessionId: string; readonly transcript: string }
  | { readonly type: "cancelled"; readonly sessionId: string }
  | { readonly type: "failed"; readonly sessionId: string; readonly error: DictationError }
  | { readonly type: "retry-paste"; readonly sessionId: string }
  | { readonly type: "dismiss"; readonly sessionId: string }
  | { readonly type: "interactive"; readonly enabled: boolean };

export type GlobalDictationManagerSnapshot =
  | { readonly kind: "idle" }
  | { readonly kind: "routing-in-app"; readonly sessionId: string }
  | { readonly kind: "overlay-starting"; readonly sessionId: string }
  | {
      readonly kind: "recording" | "transcribing";
      readonly sessionId: string;
      readonly owner: "in-app" | "overlay";
    }
  | { readonly kind: "pasting"; readonly sessionId: string }
  | {
      readonly kind: "retryable-error";
      readonly sessionId: string;
      readonly error: DictationError;
    };
