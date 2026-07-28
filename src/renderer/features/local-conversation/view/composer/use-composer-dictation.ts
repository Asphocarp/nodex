import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { transcribeDictationBlob } from "./composer-dictation-transport";
import {
  COMPOSER_DICTATION_WAVEFORM_SAMPLE_FLOOR,
  COMPOSER_DICTATION_WAVEFORM_SAMPLE_RATE_HZ,
  consumeComposerDictationWaveformSamples,
  normalizeComposerDictationWaveformSamples,
  resolveComposerDictationWaveformGeometry,
} from "./composer-dictation-waveform";

type DictationStopMode = "insert" | "send";

const MINIMUM_DICTATION_DURATION_MS = 250;

export interface ComposerDictationController {
  isDictating: boolean;
  isTranscribing: boolean;
  recordingDurationMs: number;
  waveformCanvasRef: RefObject<HTMLCanvasElement | null>;
  startDictation: () => Promise<void>;
  stopDictation: (mode: DictationStopMode) => void;
}

interface UseComposerDictationInput {
  enabled: boolean;
  onTranscriptInsert: (text: string) => void;
  onTranscriptSend: (text: string) => void;
  onStartError: (error: unknown) => void;
  onTranscribeError: (error: unknown) => void;
  onUnsupported: () => void;
}

interface DictationWaveformController {
  getCurrentRecordingDurationMs: () => number;
  recordingDurationMs: number;
  waveformCanvasRef: RefObject<HTMLCanvasElement | null>;
  startWaveformCapture: (stream: MediaStream) => void;
  stopWaveformCapture: () => void;
  resetWaveformDisplay: () => void;
}

export function isComposerDictationShortcut(event: globalThis.KeyboardEvent): boolean {
  if (event.defaultPrevented) {
    return false;
  }

  if (event.altKey || event.metaKey || event.shiftKey || !event.ctrlKey) {
    return false;
  }

  return event.key.toLowerCase() === "m";
}

export function isComposerDictationShortcutTargetBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("[data-codex-terminal]"));
}

export function formatComposerDictationDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function useComposerDictationWaveform(): DictationWaveformController {
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformLevelsRef = useRef<number[]>([]);
  const pendingSamplesRef = useRef<Float32Array>(new Float32Array());
  const waveformBucketSizeRef = useRef(1);
  const waveformSampleRateRef = useRef(COMPOSER_DICTATION_WAVEFORM_SAMPLE_RATE_HZ);
  const lastDurationSecondRef = useRef(-1);

  const resetWaveformDimensions = useCallback((canvas: HTMLCanvasElement | null): boolean => {
    if (!canvas || canvas.clientWidth <= 0) {
      return false;
    }

    const { bucketCount, bucketSize } = resolveComposerDictationWaveformGeometry(
      canvas.clientWidth,
      waveformSampleRateRef.current,
    );
    waveformLevelsRef.current = Array.from(
      { length: bucketCount },
      () => COMPOSER_DICTATION_WAVEFORM_SAMPLE_FLOOR,
    );
    waveformBucketSizeRef.current = bucketSize;
    pendingSamplesRef.current = new Float32Array();
    return true;
  }, []);

  const clearWaveformCanvas = useCallback(() => {
    const canvas = waveformCanvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const stopWaveformCapture = useCallback(() => {
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }

    if (mediaStreamSourceRef.current) {
      mediaStreamSourceRef.current.disconnect();
      mediaStreamSourceRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    recordingStartedAtRef.current = null;
    waveformLevelsRef.current = [];
    pendingSamplesRef.current = new Float32Array();
    waveformBucketSizeRef.current = 1;
    waveformSampleRateRef.current = COMPOSER_DICTATION_WAVEFORM_SAMPLE_RATE_HZ;
    lastDurationSecondRef.current = -1;
    clearWaveformCanvas();
  }, [clearWaveformCanvas]);

  const resetWaveformDisplay = useCallback(() => {
    waveformLevelsRef.current = [];
    pendingSamplesRef.current = new Float32Array();
    waveformBucketSizeRef.current = 1;
    setRecordingDurationMs(0);
    lastDurationSecondRef.current = -1;
  }, []);

  const drawWaveform = useCallback(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const { clientHeight, clientWidth } = canvas;
    if (clientHeight === 0 || clientWidth === 0) {
      return;
    }

    const { bucketCount } = resolveComposerDictationWaveformGeometry(
      clientWidth,
      waveformSampleRateRef.current,
    );
    if (waveformLevelsRef.current.length !== bucketCount) {
      resetWaveformDimensions(canvas);
    }

    const waveformLevels = waveformLevelsRef.current;
    if (waveformLevels.length === 0) {
      return;
    }

    let firstActiveIndex = -1;
    for (let index = 0; index < waveformLevels.length; index += 1) {
      if ((waveformLevels[index] ?? 0) > COMPOSER_DICTATION_WAVEFORM_SAMPLE_FLOOR) {
        firstActiveIndex = index;
        break;
      }
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = clientWidth * devicePixelRatio;
    canvas.height = clientHeight * devicePixelRatio;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();

    const halfHeight = canvas.height * 0.5;
    context.translate(0, halfHeight);

    const barWidth = canvas.width / waveformLevels.length;
    const color = getComputedStyle(canvas).color || "#000";
    for (let index = 0; index < waveformLevels.length; index += 1) {
      const level = (waveformLevels[index] ?? 0) * 10;
      const barHeight = level * halfHeight;
      const x = index * barWidth;
      context.globalAlpha = firstActiveIndex === -1 || index < firstActiveIndex ? 0.35 : 1;
      context.fillStyle = color;
      context.fillRect(x, -barHeight, barWidth / 2, barHeight * 2);
    }

    context.restore();
  }, [resetWaveformDimensions]);

  const startWaveformCapture = useCallback((stream: MediaStream) => {
    stopWaveformCapture();
    resetWaveformDisplay();
    resetWaveformDimensions(waveformCanvasRef.current);
    drawWaveform();

    if (typeof AudioContext === "undefined") {
      return;
    }

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    waveformSampleRateRef.current = audioContext.sampleRate
      || COMPOSER_DICTATION_WAVEFORM_SAMPLE_RATE_HZ;
    resetWaveformDimensions(waveformCanvasRef.current);
    drawWaveform();

    const mediaStreamSource = audioContext.createMediaStreamSource(stream);
    mediaStreamSourceRef.current = mediaStreamSource;

    const scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);
    scriptProcessorRef.current = scriptProcessor;
    recordingStartedAtRef.current = performance.now();

    scriptProcessor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      normalizeComposerDictationWaveformSamples(input);

      if (waveformLevelsRef.current.length === 0) {
        resetWaveformDimensions(waveformCanvasRef.current);
      }

      const maxBuckets = waveformLevelsRef.current.length;
      const bucketSize = waveformBucketSizeRef.current;
      if (maxBuckets > 0) {
        const result = consumeComposerDictationWaveformSamples({
          bucketSize,
          levels: waveformLevelsRef.current,
          maxLevelCount: maxBuckets,
          pendingSamples: pendingSamplesRef.current,
          samples: input,
        });
        pendingSamplesRef.current = result.pendingSamples;

        if (result.appendedLevelCount > 0) {
          drawWaveform();
        }
      }

      if (recordingStartedAtRef.current === null) {
        return;
      }

      const elapsedSeconds = Math.max(
        0,
        Math.floor((performance.now() - recordingStartedAtRef.current) / 1000),
      );
      if (elapsedSeconds !== lastDurationSecondRef.current) {
        lastDurationSecondRef.current = elapsedSeconds;
        setRecordingDurationMs(elapsedSeconds * 1000);
      }
    };

    mediaStreamSource.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);
  }, [
    drawWaveform,
    resetWaveformDimensions,
    resetWaveformDisplay,
    stopWaveformCapture,
  ]);

  useEffect(() => () => {
    stopWaveformCapture();
  }, [stopWaveformCapture]);

  return {
    getCurrentRecordingDurationMs: () =>
      recordingStartedAtRef.current === null
        ? recordingDurationMs
        : Math.max(0, performance.now() - recordingStartedAtRef.current),
    recordingDurationMs,
    waveformCanvasRef,
    startWaveformCapture,
    stopWaveformCapture,
    resetWaveformDisplay,
  };
}

export function useComposerDictation(input: UseComposerDictationInput): ComposerDictationController {
  const [isDictating, setIsDictating] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const stopModeRef = useRef<DictationStopMode | null>(null);
  const isMountedRef = useRef(true);
  const startAttemptRef = useRef(0);
  const callbacksRef = useRef(input);
  const {
    getCurrentRecordingDurationMs,
    recordingDurationMs,
    waveformCanvasRef,
    startWaveformCapture,
    stopWaveformCapture,
    resetWaveformDisplay,
  } = useComposerDictationWaveform();

  callbacksRef.current = input;

  const cleanupStream = useCallback(() => {
    if (!streamRef.current) {
      return;
    }

    for (const track of streamRef.current.getTracks()) {
      track.stop();
    }

    streamRef.current = null;
  }, []);

  const cleanupRecorder = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) {
      return;
    }

    recorder.ondataavailable = null;
    recorder.onstop = null;
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    recorderRef.current = null;
  }, []);

  const finalizeDictation = useCallback(async () => {
    const stopMode = stopModeRef.current ?? "insert";
    stopModeRef.current = null;

    const recordingDuration = Math.max(recordingDurationMs, getCurrentRecordingDurationMs());
    const recorder = recorderRef.current;
    const audioChunks = audioChunksRef.current;

    audioChunksRef.current = [];
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
    }
    recorderRef.current = null;

    stopWaveformCapture();
    cleanupStream();
    setIsDictating(false);
    resetWaveformDisplay();

    if (audioChunks.length === 0 || recordingDuration < MINIMUM_DICTATION_DURATION_MS) {
      return;
    }

    const contentType = recorder?.mimeType || audioChunks[0]?.type || "audio/webm";
    const blob = new Blob(audioChunks, { type: contentType });

    setIsTranscribing(true);
    try {
      const transcript = (await transcribeDictationBlob(blob)).trim();
      if (transcript.length === 0) {
        return;
      }

      if (stopMode === "send") {
        callbacksRef.current.onTranscriptSend(transcript);
        return;
      }

      callbacksRef.current.onTranscriptInsert(transcript);
    } catch (error) {
      callbacksRef.current.onTranscribeError(error);
    } finally {
      setIsTranscribing(false);
    }
  }, [
    cleanupStream,
    getCurrentRecordingDurationMs,
    recordingDurationMs,
    resetWaveformDisplay,
    stopWaveformCapture,
  ]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      startAttemptRef.current += 1;
      stopWaveformCapture();
      cleanupRecorder();
      cleanupStream();
      audioChunksRef.current = [];
    };
  }, [cleanupRecorder, cleanupStream, stopWaveformCapture]);

  const startDictation = useCallback(async () => {
    if (isDictating || isTranscribing) {
      return;
    }

    if (
      !input.enabled
      || typeof navigator === "undefined"
      || typeof navigator.mediaDevices?.getUserMedia !== "function"
      || typeof MediaRecorder === "undefined"
    ) {
      callbacksRef.current.onUnsupported();
      return;
    }

    const startAttempt = startAttemptRef.current + 1;
    startAttemptRef.current = startAttempt;

    try {
      stopWaveformCapture();
      stopModeRef.current = "insert";
      window.api?.requestMicrophonePermission?.();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
        },
      });
      if (!isMountedRef.current || startAttempt !== startAttemptRef.current) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      streamRef.current = stream;
      startWaveformCapture(stream);

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        void finalizeDictation();
      };
      recorder.start();
      setIsDictating(true);
    } catch (error) {
      if (!isMountedRef.current || startAttempt !== startAttemptRef.current) {
        return;
      }

      callbacksRef.current.onStartError(error);
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
      }
      recorderRef.current = null;
      stopWaveformCapture();
      resetWaveformDisplay();
      cleanupStream();
      audioChunksRef.current = [];
    }
  }, [
    cleanupStream,
    finalizeDictation,
    input.enabled,
    isDictating,
    isTranscribing,
    resetWaveformDisplay,
    startWaveformCapture,
    stopWaveformCapture,
  ]);

  const stopDictation = useCallback((mode: DictationStopMode) => {
    stopModeRef.current = mode;
    const recorder = recorderRef.current;
    if (!recorder) {
      void finalizeDictation();
      return;
    }

    if (recorder.state === "inactive") {
      void finalizeDictation();
      return;
    }

    recorder.stop();
  }, [finalizeDictation]);

  return {
    isDictating,
    isTranscribing,
    recordingDurationMs,
    waveformCanvasRef,
    startDictation,
    stopDictation,
  };
}
