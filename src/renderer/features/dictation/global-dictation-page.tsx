import { useEffect, useRef, useState } from "react";
import { DictationMicrophoneIcon } from "@/components/shared/icons";
import type { IpcApi } from "../../../shared/ipc-api";
import type { GlobalDictationRendererEvent } from "../../../shared/global-dictation";
import type { DictationSettings, MicrophoneAccessResult } from "../../../shared/dictation";
import { DEFAULT_DICTATION_SETTINGS } from "../../../shared/dictation";
import { acquireMicrophone } from "./microphone-acquirer";
import { browserDictationRecorderFactory } from "./dictation-recorder";
import { createDictationHistoryPort } from "./dictation-history-client";
import { mainDictationStreamingPort } from "./dictation-streaming-client";
import { transcribeDictationBlob } from "./dictation-buffered-client";
import { cleanupDictationTranscript } from "./dictation-cleanup-client";
import {
  DictationSessionController,
  type DictationControllerPorts,
} from "./dictation-session-controller";
import { browserDictationWaveformPort } from "./dictation-waveform";
import { useDictationSession } from "./use-dictation-session";

const invoke = async <Channel extends keyof IpcApi>(
  channel: Channel,
  ...args: IpcApi[Channel]["args"]
): Promise<IpcApi[Channel]["result"]> => {
  const bridge = window.globalDictation;
  if (!bridge) throw new Error("Global dictation bridge is unavailable");
  return (await bridge.invoke(channel, ...args)) as IpcApi[Channel]["result"];
};

const sendEvent = (event: GlobalDictationRendererEvent): Promise<boolean> =>
  window.globalDictation?.sendEvent(event) ?? Promise.resolve(false);

const defaultClock: DictationControllerPorts["clock"] = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer),
};

const createGlobalHistoryPort = (): DictationControllerPorts["history"] =>
  createDictationHistoryPort({
    create: async (input) => await invoke("codex:dictation:history:create", input),
    append: async (input) => await invoke("codex:dictation:history:append", input),
    finalize: async (input) => await invoke("codex:dictation:history:finalize", input),
    setTranscript: async (input) => await invoke("codex:dictation:history:set-transcript", input),
  });

const transcribe = async (blob: Blob, signal: AbortSignal): Promise<string> =>
  await transcribeDictationBlob(blob, {
    signal,
    transcribe: async (input) => {
      const requestId = crypto.randomUUID();
      const cancel = (): void => {
        void invoke("codex:dictation:transcribe:cancel", requestId).catch(() => undefined);
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        return await invoke("codex:dictation:transcribe", { ...input, requestId });
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
  });

const errorMessage = (kind: string): string => {
  if (kind === "microphone-permission-denied" || kind === "microphone-restricted") {
    return "Microphone access is blocked";
  }
  if (kind === "microphone-not-found") return "No microphone found";
  if (kind === "microphone-busy") return "Microphone is busy";
  if (kind.startsWith("transcription-")) return "Couldn’t transcribe audio";
  if (kind === "accessibility-denied") return "Accessibility access is required";
  if (kind === "paste-failed") return "Couldn’t paste text";
  return "Dictation stopped unexpectedly";
};

const playFeedbackTone = (frequency: number): void => {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime;
    const stopAt = startAt + 0.09;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
    oscillator.start(startAt);
    oscillator.stop(stopAt);
  } catch {
    // Feedback is intentionally best-effort; capture must not depend on audio playback.
  }
};

export type GlobalDictationBarState =
  | "initializing"
  | "idle"
  | "listening"
  | "transcribing"
  | "error";

export function GlobalDictationBar({
  state,
  waveform,
  error,
  onCancel,
  onOpenSettings,
  onRetry,
}: {
  readonly state: GlobalDictationBarState;
  readonly waveform: readonly number[];
  readonly error?: import("../../../shared/dictation").DictationError | null;
  readonly onCancel: () => void;
  readonly onOpenSettings?: () => void;
  readonly onRetry: () => void;
}) {
  const stateLabel =
    state === "listening"
      ? "Listening"
      : state === "transcribing"
        ? "Transcribing"
        : state === "error"
          ? errorMessage(error?.kind ?? "unknown")
          : state === "idle"
            ? "Ready"
            : "Preparing microphone";
  return (
    <section
      aria-label="Global dictation"
      onMouseEnter={() => void sendEvent({ type: "interactive", enabled: true })}
      onMouseLeave={() => void sendEvent({ type: "interactive", enabled: false })}
      className="flex h-[68px] w-[704px] items-center gap-4 rounded-[22px] border border-white/12 bg-[#171918]/94 px-5 text-white shadow-[0_16px_48px_rgba(0,0,0,0.42)] backdrop-blur-2xl"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#d7ff64] text-[#141611]">
        <DictationMicrophoneIcon />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium tracking-[-0.01em]">{stateLabel}</div>
        <div className="mt-1 flex h-5 items-center gap-[3px] overflow-hidden">
          {Array.from({ length: 48 }, (_, index) => {
            const level = waveform[index % Math.max(1, waveform.length)] ?? 0.08;
            return (
              <span
                key={index}
                className="w-[2px] rounded-full bg-[#d7ff64]/80 transition-[height] duration-75"
                style={{ height: `${Math.max(3, Math.min(18, level * 18))}px` }}
              />
            );
          })}
        </div>
      </div>
      {state === "error" ? (
        <div className="flex items-center gap-1">
          {error?.kind === "accessibility-denied" && onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-lg px-3 py-2 text-xs font-medium text-white/75 hover:bg-white/8 hover:text-white"
            >
              Open Settings
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg px-3 py-2 text-xs font-medium text-[#d7ff64] hover:bg-white/8"
          >
            Retry
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-white/8 hover:text-white"
      >
        Cancel
      </button>
    </section>
  );
}

export function GlobalDictationRoot() {
  const activeSessionIdRef = useRef<string | null>(null);
  const completionReportedRef = useRef(false);
  const lastStateEventRef = useRef<string | null>(null);
  const previousSnapshotKindRef = useRef("idle");
  const appliedCompletionIdsRef = useRef(new Set<string>());
  const [settings, setSettings] = useState<DictationSettings>(DEFAULT_DICTATION_SETTINGS);
  const [externalError, setExternalError] = useState<
    import("../../../shared/dictation").DictationError | null
  >(null);
  const [controller] = useState(
    () =>
      new DictationSessionController({
        lease: {
          acquire: async (sessionId, surface) =>
            await invoke("codex:dictation:microphone-lease:acquire", { sessionId, surface }),
          release: async (sessionId) => {
            await invoke("codex:dictation:microphone-lease:release", sessionId);
          },
        },
        permissions: {
          request: async () =>
            (await invoke("codex:dictation:microphone-access:request")) as MicrophoneAccessResult,
        },
        devices: {
          acquire: async () => {
            const [nextSettings, builtInMicrophoneLabelHint] = await Promise.all([
              invoke("codex:dictation:settings:read").catch(() => DEFAULT_DICTATION_SETTINGS),
              invoke("codex:dictation:microphone-route-hint:read").catch(() => null),
            ]);
            setSettings(nextSettings);
            return await acquireMicrophone({
              mediaDevices: navigator.mediaDevices,
              selectedDeviceId: nextSettings.microphoneInputDeviceId,
              builtInMicrophoneLabelHint,
            });
          },
        },
        recorder: browserDictationRecorderFactory,
        waveform: browserDictationWaveformPort,
        streaming: mainDictationStreamingPort,
        buffered: { transcribe },
        cleanup: {
          transcript: async (transcript, signal) =>
            await cleanupDictationTranscript(transcript, {
              signal,
              cleanup: async (input) => await invoke("codex:dictation:cleanup", input),
              cancel: async (requestId) =>
                await invoke("codex:dictation:transcribe:cancel", requestId),
            }),
        },
        history: createGlobalHistoryPort(),
        completion: {
          apply: async ({ sessionId: recordingSessionId, transcript }) => {
            if (appliedCompletionIdsRef.current.has(recordingSessionId)) return;
            appliedCompletionIdsRef.current.add(recordingSessionId);
            const sessionId = activeSessionIdRef.current;
            if (!sessionId) return;
            completionReportedRef.current = true;
            await sendEvent({ type: "completed", sessionId, transcript }).catch(() => false);
          },
        },
        clock: defaultClock,
        createId: () => crypto.randomUUID(),
      }),
  );
  const snapshot = useDictationSession(controller);

  useEffect(() => {
    void invoke("codex:dictation:settings:read")
      .then(setSettings)
      .catch(() => undefined);
    void sendEvent({ type: "ready" });
    return () => controller.dispose();
  }, [controller]);

  useEffect(() => {
    const bridge = window.globalDictation;
    if (!bridge) return;
    return bridge.onCommand((command) => {
      if (command.type === "start") {
        if (controller.getSnapshot().kind !== "idle") return;
        activeSessionIdRef.current = command.sessionId;
        completionReportedRef.current = false;
        setExternalError(null);
        lastStateEventRef.current = null;
        void sendEvent({ type: "accepted", sessionId: command.sessionId }).then(
          async (accepted) => {
            if (!accepted || activeSessionIdRef.current !== command.sessionId) {
              if (activeSessionIdRef.current === command.sessionId) {
                activeSessionIdRef.current = null;
              }
              return;
            }
            await controller.start({ surface: "global", gesture: command.gesture });
          },
        );
        return;
      }
      if (command.sessionId !== activeSessionIdRef.current) return;
      if (command.type === "paste-failed") {
        setExternalError(command.error);
        return;
      }
      if (command.type === "finish") {
        activeSessionIdRef.current = null;
        setExternalError(null);
        return;
      }
      if (command.type === "stop") controller.stop("insert");
      else controller.cancel();
    });
  }, [controller]);

  useEffect(() => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    const nextEvent =
      snapshot.kind === "recording"
        ? "listening"
        : snapshot.kind === "transcribing"
          ? "transcribing"
          : null;
    if (nextEvent && lastStateEventRef.current !== nextEvent) {
      lastStateEventRef.current = nextEvent;
      void sendEvent({ type: "state", sessionId, state: nextEvent });
      return;
    }
    if (snapshot.kind === "retryable-error") {
      const identity = `failed:${snapshot.error.kind}`;
      if (lastStateEventRef.current === identity) return;
      lastStateEventRef.current = identity;
      void sendEvent({ type: "failed", sessionId, error: snapshot.error });
      return;
    }
    if (snapshot.kind === "idle" && !completionReportedRef.current) {
      activeSessionIdRef.current = null;
      void sendEvent({ type: "cancelled", sessionId });
    }
  }, [snapshot]);

  useEffect(() => {
    const previousKind = previousSnapshotKindRef.current;
    previousSnapshotKindRef.current = snapshot.kind;
    if (snapshot.kind === "recording" && previousKind !== "recording") {
      if (settings.playStartSound) playFeedbackTone(660);
      return;
    }
    if (snapshot.kind !== "recording" && previousKind === "recording" && settings.playStopSound) {
      playFeedbackTone(440);
    }
  }, [settings.playStartSound, settings.playStopSound, snapshot.kind]);

  const retry = (): void => {
    if (externalError) {
      const sessionId = activeSessionIdRef.current;
      if (sessionId) void sendEvent({ type: "retry-paste", sessionId });
      return;
    }
    if (snapshot.kind !== "retryable-error") return;
    if (snapshot.canRetryRecording) {
      void controller.retry();
      return;
    }
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    void controller.start({ surface: "global", gesture: "retry" });
  };

  const cancel = (): void => {
    const sessionId = activeSessionIdRef.current;
    controller.cancel();
    if (!sessionId) return;
    activeSessionIdRef.current = null;
    void sendEvent({ type: externalError ? "dismiss" : "cancelled", sessionId });
  };

  const waveform = snapshot.kind === "recording" ? snapshot.waveform : [];
  const visibleError =
    externalError ?? (snapshot.kind === "retryable-error" ? snapshot.error : null);
  const barState: GlobalDictationBarState = visibleError
    ? "error"
    : snapshot.kind === "recording"
      ? "listening"
      : snapshot.kind === "transcribing" || snapshot.kind === "stopping"
        ? "transcribing"
        : activeSessionIdRef.current
          ? "initializing"
          : "idle";

  return (
    <main className="flex h-screen w-screen items-center justify-center bg-transparent p-0">
      <GlobalDictationBar
        state={barState}
        waveform={waveform}
        error={visibleError}
        onCancel={cancel}
        onOpenSettings={
          visibleError?.kind === "accessibility-denied"
            ? () => {
                void invoke("codex:dictation:global-permissions:open-accessibility-settings");
              }
            : undefined
        }
        onRetry={retry}
      />
    </main>
  );
}
