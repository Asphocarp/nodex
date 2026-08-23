import { useEffect, useRef, useState, type RefObject } from "react";
import {
  createCommandKeymapState,
  matchesKeyboardEventToCommand,
  type CommandKeymapState,
} from "../../../../../shared/command-keybindings";
import type { DictationError, DictationStopAction } from "../../../../../shared/dictation";
import type {
  GlobalDictationRendererCommand,
  GlobalDictationRendererEvent,
} from "../../../../../shared/global-dictation";
import {
  acquireDictationMicrophoneLease,
  invoke,
  readBuiltInMicrophoneRouteHint,
  readDictationSettings,
  requestMicrophoneAccess,
  releaseDictationMicrophoneLease,
} from "@/lib/api";
import { acquireMicrophone } from "@/features/dictation/microphone-acquirer";
import { browserDictationRecorderFactory } from "@/features/dictation/dictation-recorder";
import { mainDictationHistoryPort } from "@/features/dictation/dictation-history-client";
import { mainDictationStreamingPort } from "@/features/dictation/dictation-streaming-client";
import {
  DictationSessionController,
  type DictationControllerPorts,
} from "@/features/dictation/dictation-session-controller";
import { browserDictationWaveformPort } from "@/features/dictation/dictation-waveform";
import { useDictationSession } from "@/features/dictation/use-dictation-session";
import { transcribeDictationBlob } from "@/features/dictation/dictation-buffered-client";

type DictationStopMode = Extract<DictationStopAction, "insert" | "send">;

export interface ComposerDictationController {
  readonly isDictating: boolean;
  readonly isTranscribing: boolean;
  readonly recordingDurationMs: number;
  readonly waveformCanvasRef: RefObject<HTMLCanvasElement | null>;
  readonly startDictation: () => Promise<void>;
  readonly stopDictation: (mode: DictationStopMode) => void;
  readonly retryDictation: () => Promise<void>;
  readonly cancelDictation: () => void;
  readonly retryableError: DictationError | null;
}

interface UseComposerDictationInput {
  readonly enabled: boolean;
  readonly onTranscriptInsert: (text: string) => void;
  readonly onTranscriptSend: (text: string) => void;
  readonly onStartError: (error: DictationError) => void;
  readonly onTranscribeError: (error: DictationError) => void;
  readonly onUnsupported: () => void;
}

export function isComposerDictationShortcut(
  event: globalThis.KeyboardEvent,
  commandKeymapState: CommandKeymapState = createCommandKeymapState(),
): boolean {
  if (event.defaultPrevented) return false;
  return matchesKeyboardEventToCommand(event, commandKeymapState, "composerDictationHold");
}

export function isComposerDictationShortcutTargetBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("[data-codex-terminal]"));
}

export function formatComposerDictationDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const defaultClock: DictationControllerPorts["clock"] = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer),
};

const invokeGlobalDictationEvent = async (event: GlobalDictationRendererEvent): Promise<boolean> =>
  await invoke("global-dictation:event", event);

const drawWaveform = (canvas: HTMLCanvasElement, waveform: readonly number[]): void => {
  const context = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!context || width <= 0 || height <= 0) return;
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (waveform.length === 0) return;
  const barStep = width / waveform.length;
  const barWidth = Math.max(1, barStep * 0.45);
  context.fillStyle = getComputedStyle(canvas).color || "currentColor";
  for (let index = 0; index < waveform.length; index += 1) {
    const level = Math.max(0.04, Math.min(1, waveform[index] ?? 0.04));
    const barHeight = Math.max(2, level * height);
    context.globalAlpha = 0.45 + level * 0.55;
    context.fillRect(index * barStep, (height - barHeight) / 2, barWidth, barHeight);
  }
};

export function useComposerDictation(
  input: UseComposerDictationInput,
): ComposerDictationController {
  const callbacksRef = useRef(input);
  callbacksRef.current = input;
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const reportedErrorRef = useRef<string | null>(null);
  const globalSessionIdRef = useRef<string | null>(null);
  const globalCompletionReportedRef = useRef(false);
  const lastGlobalStateRef = useRef<string | null>(null);
  const appliedCompletionIdsRef = useRef(new Set<string>());
  const [controller] = useState(
    () =>
      new DictationSessionController({
        lease: {
          acquire: acquireDictationMicrophoneLease,
          release: async (sessionId) => void (await releaseDictationMicrophoneLease(sessionId)),
        },
        permissions: { request: requestMicrophoneAccess },
        devices: {
          acquire: async () => {
            const [settings, builtInMicrophoneLabelHint] = await Promise.all([
              readDictationSettings().catch(() => ({
                microphoneInputDeviceId: null,
                keepGlobalBarVisible: false,
                playStartSound: true,
                playStopSound: true,
                globalShortcutNudgeDismissed: false,
              })),
              readBuiltInMicrophoneRouteHint().catch(() => null),
            ]);
            return await acquireMicrophone({
              mediaDevices: navigator.mediaDevices,
              selectedDeviceId: settings.microphoneInputDeviceId,
              builtInMicrophoneLabelHint,
            });
          },
        },
        recorder: browserDictationRecorderFactory,
        waveform: browserDictationWaveformPort,
        streaming: mainDictationStreamingPort,
        buffered: {
          transcribe: async (blob, signal) => {
            if (signal.aborted) throw new DOMException("Dictation was aborted", "AbortError");
            const result = await transcribeDictationBlob(blob, { signal });
            if (signal.aborted) throw new DOMException("Dictation was aborted", "AbortError");
            return result;
          },
        },
        history: mainDictationHistoryPort,
        completion: {
          apply: async ({ sessionId, action, transcript }) => {
            if (appliedCompletionIdsRef.current.has(sessionId)) return;
            appliedCompletionIdsRef.current.add(sessionId);
            const globalSessionId = globalSessionIdRef.current;
            if (globalSessionId) {
              callbacksRef.current.onTranscriptInsert(transcript);
              globalCompletionReportedRef.current = true;
              await invokeGlobalDictationEvent({
                type: "completed",
                sessionId: globalSessionId,
                transcript,
              }).catch(() => false);
              globalSessionIdRef.current = null;
              return;
            }
            if (action === "send") {
              callbacksRef.current.onTranscriptSend(transcript);
              return;
            }
            callbacksRef.current.onTranscriptInsert(transcript);
          },
        },
        clock: defaultClock,
        createId: () => crypto.randomUUID(),
      }),
  );
  const snapshot = useDictationSession(controller);

  useEffect(() => {
    if (input.enabled) return;
    controller.cancel();
  }, [controller, input.enabled]);

  useEffect(() => {
    if (!window.api) return;
    return window.api.on("global-dictation:command", (value) => {
      const command = value as GlobalDictationRendererCommand;
      if (!command || typeof command !== "object" || !("sessionId" in command)) return;
      if (command.type === "start") {
        if (!callbacksRef.current.enabled || controller.getSnapshot().kind !== "idle") return;
        globalSessionIdRef.current = command.sessionId;
        globalCompletionReportedRef.current = false;
        lastGlobalStateRef.current = null;
        void invokeGlobalDictationEvent({ type: "accepted", sessionId: command.sessionId }).then(
          async (accepted) => {
            if (!accepted || globalSessionIdRef.current !== command.sessionId) {
              if (globalSessionIdRef.current === command.sessionId)
                globalSessionIdRef.current = null;
              return;
            }
            await controller.start({ surface: "global", gesture: command.gesture });
          },
        );
        return;
      }
      if (command.sessionId !== globalSessionIdRef.current) return;
      if (command.type === "stop") controller.stop("insert");
      else if (command.type === "cancel") controller.cancel();
    });
  }, [controller]);

  useEffect(() => {
    if (snapshot.kind !== "recording") return;
    const canvas = waveformCanvasRef.current;
    if (canvas) drawWaveform(canvas, snapshot.waveform);
  }, [snapshot]);

  useEffect(() => {
    if (snapshot.kind !== "retryable-error") {
      reportedErrorRef.current = null;
      return;
    }
    const identity = `${snapshot.sessionId}:${snapshot.error.kind}:${snapshot.canRetryRecording}`;
    if (reportedErrorRef.current === identity) return;
    reportedErrorRef.current = identity;
    if (!snapshot.canRetryRecording) {
      callbacksRef.current.onStartError(snapshot.error);
      return;
    }
    callbacksRef.current.onTranscribeError(snapshot.error);
  }, [snapshot]);

  useEffect(() => {
    const sessionId = globalSessionIdRef.current;
    if (!sessionId) return;
    const nextState =
      snapshot.kind === "recording"
        ? "listening"
        : snapshot.kind === "transcribing"
          ? "transcribing"
          : null;
    if (nextState && lastGlobalStateRef.current !== nextState) {
      lastGlobalStateRef.current = nextState;
      void invokeGlobalDictationEvent({ type: "state", sessionId, state: nextState });
      return;
    }
    if (snapshot.kind === "retryable-error") {
      const identity = `failed:${snapshot.error.kind}`;
      if (lastGlobalStateRef.current === identity) return;
      lastGlobalStateRef.current = identity;
      void invokeGlobalDictationEvent({ type: "failed", sessionId, error: snapshot.error });
      return;
    }
    if (snapshot.kind === "idle" && !globalCompletionReportedRef.current) {
      globalSessionIdRef.current = null;
      void invokeGlobalDictationEvent({ type: "cancelled", sessionId });
    }
  }, [snapshot]);

  const startDictation = async (): Promise<void> => {
    if (
      !callbacksRef.current.enabled ||
      typeof navigator.mediaDevices?.getUserMedia !== "function" ||
      typeof MediaRecorder === "undefined"
    ) {
      callbacksRef.current.onUnsupported();
      return;
    }
    globalSessionIdRef.current = null;
    await controller.start({ surface: "composer", gesture: "click" });
  };

  const isDictating = [
    "requesting-permission",
    "acquiring-stream",
    "recording",
    "stopping",
  ].includes(snapshot.kind);
  const recordingDurationMs =
    snapshot.kind === "recording" ||
    snapshot.kind === "stopping" ||
    snapshot.kind === "transcribing"
      ? snapshot.durationMs
      : 0;

  return {
    isDictating,
    isTranscribing: snapshot.kind === "transcribing",
    recordingDurationMs,
    waveformCanvasRef,
    startDictation,
    stopDictation: (mode) => controller.stop(mode),
    retryDictation: () => controller.retry(),
    cancelDictation: () => controller.cancel(),
    retryableError: snapshot.kind === "retryable-error" ? snapshot.error : null,
  };
}
