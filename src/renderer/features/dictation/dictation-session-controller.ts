import type {
  DictationError,
  DictationGesture,
  DictationStopAction,
  DictationStopReason,
  DictationSurface,
  MicrophoneAccessResult,
} from "../../../shared/dictation";
import {
  classifyDictationCaptureError,
  classifyDictationTranscriptionError,
} from "./dictation-errors";

export const MINIMUM_DICTATION_DURATION_MS = 250;
export const MAXIMUM_DICTATION_DURATION_MS = 595_000;
export const DICTATION_HISTORY_CHUNK_INTERVAL_MS = 5_000;

type Timer = ReturnType<typeof globalThis.setTimeout>;

export type DictationSessionSnapshot =
  | { readonly kind: "idle" }
  | {
      readonly kind: "requesting-permission" | "acquiring-stream";
      readonly sessionId: string;
    }
  | {
      readonly kind: "recording";
      readonly sessionId: string;
      readonly durationMs: number;
      readonly waveform: readonly number[];
    }
  | {
      readonly kind: "stopping" | "transcribing";
      readonly sessionId: string;
      readonly durationMs: number;
    }
  | {
      readonly kind: "retryable-error";
      readonly sessionId: string;
      readonly error: DictationError;
      readonly canRetryRecording: boolean;
    };

export interface DictationRecorderHandle {
  readonly mimeType: string;
  readonly state: "inactive" | "paused" | "recording";
  start(timesliceMs: number): void;
  stop(): void;
  dispose(): void;
}

export interface DictationRecorderFactory {
  create(
    stream: MediaStream,
    callbacks: {
      readonly onChunk: (chunk: Blob) => void;
      readonly onError: (error: unknown) => void;
      readonly onStop: () => void;
    },
  ): DictationRecorderHandle;
}

export interface DictationWaveformSession {
  dispose(): void;
}

export interface DictationStreamingAttempt {
  start(stream: MediaStream): Promise<void>;
  finish(): Promise<string | null>;
  abort(): void;
}

export interface DictationControllerPorts {
  readonly lease: {
    acquire(sessionId: string, surface: DictationSurface): Promise<boolean>;
    release(sessionId: string): Promise<void>;
  };
  readonly permissions: {
    request(): Promise<MicrophoneAccessResult>;
  };
  readonly devices: {
    acquire(): Promise<MediaStream>;
  };
  readonly recorder: DictationRecorderFactory;
  readonly waveform: {
    start(
      stream: MediaStream,
      onSamples: (samples: readonly number[]) => void,
    ): DictationWaveformSession;
  };
  readonly streaming: {
    prepare(sessionId: string): Promise<DictationStreamingAttempt>;
  };
  readonly buffered: {
    transcribe(blob: Blob, signal: AbortSignal, sessionId: string): Promise<string>;
  };
  readonly history: {
    create(input: {
      readonly sessionId: string;
      readonly surface: DictationSurface;
      readonly mimeType: string;
      readonly createdAtMs: number;
    }): Promise<void>;
    append(sessionId: string, chunk: Blob): Promise<void>;
    finalize(input: {
      readonly sessionId: string;
      readonly status: "cancelled" | "completed";
      readonly durationMs: number;
      readonly transcript?: string;
    }): Promise<void>;
  };
  readonly completion: {
    apply(input: {
      readonly sessionId: string;
      readonly action: Exclude<DictationStopAction, "abort">;
      readonly transcript: string;
    }): Promise<void> | void;
  };
  readonly clock: {
    now(): number;
    setTimeout(callback: () => void, delayMs: number): Timer;
    clearTimeout(timer: Timer): void;
  };
  readonly createId: () => string;
}

interface ActiveSession {
  readonly id: string;
  readonly surface: DictationSurface;
  readonly gesture: DictationGesture;
  readonly generation: number;
  readonly chunks: Blob[];
  stream: MediaStream | null;
  recorder: DictationRecorderHandle | null;
  waveform: DictationWaveformSession | null;
  streaming: DictationStreamingAttempt | null;
  startedAtMs: number | null;
  stopAction: Exclude<DictationStopAction, "abort">;
  durationTimer: Timer | null;
  maximumTimer: Timer | null;
  transcriptAbort: AbortController | null;
  historyQueue: Promise<void>;
  retainedAudio: Blob | null;
  completed: boolean;
  captureError: DictationError | null;
  leaseAcquired: boolean;
}

const IDLE: DictationSessionSnapshot = { kind: "idle" };

const permissionError = (
  result: Exclude<MicrophoneAccessResult, { kind: "granted" }>,
): DictationError => {
  if (result.kind === "failed") return result.error;
  if (result.kind === "blocked") {
    return {
      kind:
        result.status === "restricted" ? "microphone-restricted" : "microphone-permission-denied",
      operation: "permission",
      retryable: false,
    };
  }
  return { kind: "capture-unsupported", operation: "permission", retryable: false };
};

const stopTracks = (stream: MediaStream | null): void => {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
};

/**
 * Owns every transient dictation resource. All async completions are generation-checked,
 * making start/stop/dispose safe under React StrictMode and late browser promises.
 */
export class DictationSessionController {
  readonly #ports: DictationControllerPorts;
  readonly #listeners = new Set<() => void>();
  #snapshot: DictationSessionSnapshot = IDLE;
  #active: ActiveSession | null = null;
  #generation = 0;
  #disposed = false;

  constructor(ports: DictationControllerPorts) {
    this.#ports = ports;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): DictationSessionSnapshot => this.#snapshot;

  async start(input: {
    readonly surface: DictationSurface;
    readonly gesture: DictationGesture;
  }): Promise<void> {
    if (this.#disposed) return;
    if (this.#active && this.#snapshot.kind === "retryable-error") {
      this.#invalidateAndRelease(this.#active, "cancelled");
    }
    if (this.#active) return;
    const generation = ++this.#generation;
    const session: ActiveSession = {
      id: this.#ports.createId(),
      surface: input.surface,
      gesture: input.gesture,
      generation,
      chunks: [],
      stream: null,
      recorder: null,
      waveform: null,
      streaming: null,
      startedAtMs: null,
      stopAction: "insert",
      durationTimer: null,
      maximumTimer: null,
      transcriptAbort: null,
      historyQueue: Promise.resolve(),
      retainedAudio: null,
      completed: false,
      captureError: null,
      leaseAcquired: false,
    };
    this.#active = session;
    this.#publish({ kind: "requesting-permission", sessionId: session.id });

    let leaseAcquired = false;
    try {
      leaseAcquired = await this.#ports.lease.acquire(session.id, session.surface);
    } catch {
      if (this.#isCurrent(session)) {
        this.#failWithoutAudio(session, {
          kind: "microphone-busy",
          operation: "capture",
          retryable: true,
        });
      }
      return;
    }
    if (!this.#isCurrent(session)) {
      if (leaseAcquired) void this.#ports.lease.release(session.id).catch(() => undefined);
      return;
    }
    if (!leaseAcquired) {
      this.#failWithoutAudio(session, {
        kind: "microphone-busy",
        operation: "capture",
        retryable: true,
      });
      return;
    }
    session.leaseAcquired = true;

    const streamingPromise = this.#ports.streaming.prepare(session.id).catch(() => null);
    let permission: MicrophoneAccessResult;
    try {
      permission = await this.#ports.permissions.request();
    } catch (error) {
      if (!this.#isCurrent(session)) return;
      void streamingPromise.then((attempt) => attempt?.abort());
      this.#failWithoutAudio(session, {
        kind: "unknown",
        operation: "permission",
        retryable: true,
        nativeName:
          error && typeof error === "object" && "name" in error
            ? String((error as { readonly name: unknown }).name)
            : undefined,
      });
      return;
    }
    if (!this.#isCurrent(session)) return;
    if (!permission || typeof permission !== "object" || !("kind" in permission)) {
      void streamingPromise.then((attempt) => attempt?.abort());
      this.#failWithoutAudio(session, {
        kind: "unknown",
        operation: "permission",
        retryable: true,
        nativeName: "InvalidPermissionResult",
      });
      return;
    }
    if (permission.kind !== "granted") {
      void streamingPromise.then((attempt) => attempt?.abort());
      this.#failWithoutAudio(session, permissionError(permission));
      return;
    }

    this.#publish({ kind: "acquiring-stream", sessionId: session.id });
    let stream: MediaStream;
    try {
      stream = await this.#ports.devices.acquire();
    } catch (error) {
      if (!this.#isCurrent(session)) return;
      void streamingPromise.then((attempt) => attempt?.abort());
      this.#failWithoutAudio(session, classifyDictationCaptureError(error));
      return;
    }
    if (!this.#isCurrent(session)) {
      stopTracks(stream);
      return;
    }
    session.stream = stream;
    session.streaming = await streamingPromise;
    if (!this.#isCurrent(session)) {
      session.streaming?.abort();
      stopTracks(stream);
      return;
    }

    try {
      const recorder = this.#ports.recorder.create(stream, {
        onChunk: (chunk) => this.#onChunk(session, chunk),
        onError: (error) => this.#onRecorderError(session, error),
        onStop: () => void this.#onRecorderStopped(session),
      });
      session.recorder = recorder;
      session.startedAtMs = this.#ports.clock.now();
      session.waveform = this.#ports.waveform.start(stream, (waveform) => {
        if (!this.#isCurrent(session) || this.#snapshot.kind !== "recording") return;
        this.#publish({ ...this.#snapshot, waveform: [...waveform] });
      });
      session.historyQueue = this.#ports.history
        .create({
          sessionId: session.id,
          surface: session.surface,
          mimeType: recorder.mimeType,
          createdAtMs: session.startedAtMs,
        })
        .catch(() => undefined);
      void session.streaming?.start(stream).catch(() => {
        session.streaming?.abort();
        session.streaming = null;
      });
      recorder.start(DICTATION_HISTORY_CHUNK_INTERVAL_MS);
      this.#publish({ kind: "recording", sessionId: session.id, durationMs: 0, waveform: [] });
      this.#scheduleDuration(session);
      session.maximumTimer = this.#ports.clock.setTimeout(() => {
        this.stop("insert", "max-duration");
      }, MAXIMUM_DICTATION_DURATION_MS);
    } catch (error) {
      this.#releaseCapture(session);
      this.#failWithoutAudio(session, classifyDictationCaptureError(error));
    }
  }

  stop(action: DictationStopAction, reason: DictationStopReason = "user"): void {
    const session = this.#active;
    if (!session || this.#disposed) return;
    if (action === "abort") {
      this.cancel();
      return;
    }
    if (session.stopAction === "insert" && action === "send") session.stopAction = "send";

    if (
      this.#snapshot.kind === "requesting-permission" ||
      this.#snapshot.kind === "acquiring-stream"
    ) {
      this.#invalidateAndRelease(session, "cancelled");
      return;
    }
    if (this.#snapshot.kind === "stopping" || this.#snapshot.kind === "transcribing") return;
    if (this.#snapshot.kind !== "recording") return;
    const durationMs = this.#duration(session);
    this.#publish({ kind: "stopping", sessionId: session.id, durationMs });
    this.#clearCaptureTimers(session);
    if (!session.recorder || session.recorder.state === "inactive") {
      void this.#onRecorderStopped(session);
      return;
    }
    try {
      session.recorder.stop();
    } catch {
      void this.#onRecorderStopped(session);
    }
    void reason;
  }

  async retry(): Promise<void> {
    const session = this.#active;
    if (
      !session ||
      this.#snapshot.kind !== "retryable-error" ||
      !session.retainedAudio ||
      this.#disposed
    ) {
      return;
    }
    await this.#transcribe(session, session.retainedAudio);
  }

  cancel(): void {
    const session = this.#active;
    if (!session) return;
    this.#invalidateAndRelease(session, "cancelled");
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const session = this.#active;
    if (session) this.#invalidateAndRelease(session, "cancelled");
    this.#listeners.clear();
  }

  #onChunk(session: ActiveSession, chunk: Blob): void {
    if (!this.#isCurrent(session) || chunk.size <= 0) return;
    session.chunks.push(chunk);
    session.historyQueue = session.historyQueue
      .then(() => this.#ports.history.append(session.id, chunk))
      .catch(() => undefined);
  }

  #onRecorderError(session: ActiveSession, error: unknown): void {
    if (!this.#isCurrent(session)) return;
    session.captureError = {
      ...classifyDictationCaptureError(error),
      kind: "capture-interrupted",
      retryable: true,
    };
    if (session.recorder && session.recorder.state !== "inactive") {
      try {
        session.recorder.stop();
      } catch {
        // Native MediaRecorder still dispatches its terminal dataavailable/stop events.
      }
    }
  }

  async #onRecorderStopped(session: ActiveSession): Promise<void> {
    if (!this.#isCurrent(session) || session.completed) return;
    session.completed = true;
    const durationMs = this.#duration(session);
    const recorder = session.recorder;
    const mimeType = recorder?.mimeType || session.chunks[0]?.type || "application/octet-stream";
    const chunks = session.chunks.splice(0);
    this.#releaseCapture(session);
    this.#releaseMicrophoneLease(session);

    if (durationMs < MINIMUM_DICTATION_DURATION_MS || chunks.length === 0) {
      session.streaming?.abort();
      await session.historyQueue;
      await this.#ports.history
        .finalize({ sessionId: session.id, status: "cancelled", durationMs })
        .catch(() => undefined);
      if (this.#isCurrent(session)) {
        this.#active = null;
        this.#publish(IDLE);
      }
      return;
    }

    const audio = new Blob(chunks, { type: mimeType });
    if (audio.size <= 0) {
      this.#active = null;
      this.#publish(IDLE);
      return;
    }
    session.retainedAudio = audio;
    if (session.captureError) {
      session.streaming?.abort();
      this.#publish({
        kind: "retryable-error",
        sessionId: session.id,
        error: session.captureError,
        canRetryRecording: true,
      });
      return;
    }
    await this.#transcribe(session, audio);
  }

  async #transcribe(session: ActiveSession, audio: Blob): Promise<void> {
    if (!this.#isCurrent(session)) return;
    const durationMs = this.#duration(session);
    this.#publish({ kind: "transcribing", sessionId: session.id, durationMs });
    session.transcriptAbort?.abort();
    const abortController = new AbortController();
    session.transcriptAbort = abortController;
    const attemptGeneration = session.generation;
    try {
      let transcript = (await session.streaming?.finish().catch(() => null))?.trim() ?? "";
      if (!transcript) {
        transcript = (
          await this.#ports.buffered.transcribe(audio, abortController.signal, session.id)
        ).trim();
      }
      if (
        !this.#isCurrent(session) ||
        session.generation !== attemptGeneration ||
        abortController.signal.aborted
      ) {
        return;
      }
      if (!transcript)
        throw Object.assign(new Error("Empty dictation transcript"), { status: 502 });
      await session.historyQueue;
      await this.#ports.history
        .finalize({
          sessionId: session.id,
          status: "completed",
          durationMs,
          transcript,
        })
        .catch(() => undefined);
      if (!this.#isCurrent(session) || abortController.signal.aborted) return;
      await this.#ports.completion.apply({
        sessionId: session.id,
        action: session.stopAction,
        transcript,
      });
      if (!this.#isCurrent(session)) return;
      session.retainedAudio = null;
      this.#active = null;
      this.#publish(IDLE);
    } catch (error) {
      if (!this.#isCurrent(session) || abortController.signal.aborted) return;
      session.completed = false;
      this.#publish({
        kind: "retryable-error",
        sessionId: session.id,
        error: classifyDictationTranscriptionError(error),
        canRetryRecording: true,
      });
    } finally {
      if (session.transcriptAbort === abortController) session.transcriptAbort = null;
    }
  }

  #scheduleDuration(session: ActiveSession): void {
    session.durationTimer = this.#ports.clock.setTimeout(() => {
      if (!this.#isCurrent(session) || this.#snapshot.kind !== "recording") return;
      this.#publish({ ...this.#snapshot, durationMs: this.#duration(session) });
      this.#scheduleDuration(session);
    }, 1_000);
  }

  #duration(session: ActiveSession): number {
    return session.startedAtMs === null
      ? 0
      : Math.max(0, this.#ports.clock.now() - session.startedAtMs);
  }

  #failWithoutAudio(session: ActiveSession, error: DictationError): void {
    if (!this.#isCurrent(session)) return;
    this.#releaseMicrophoneLease(session);
    this.#publish({
      kind: "retryable-error",
      sessionId: session.id,
      error,
      canRetryRecording: false,
    });
  }

  #invalidateAndRelease(session: ActiveSession, historyStatus: "cancelled"): void {
    ++this.#generation;
    session.transcriptAbort?.abort();
    session.streaming?.abort();
    this.#releaseCapture(session);
    this.#releaseMicrophoneLease(session);
    this.#active = null;
    this.#publish(IDLE);
    void session.historyQueue.then(() =>
      this.#ports.history
        .finalize({
          sessionId: session.id,
          status: historyStatus,
          durationMs: this.#duration(session),
        })
        .catch(() => undefined),
    );
  }

  #releaseCapture(session: ActiveSession): void {
    this.#clearCaptureTimers(session);
    const recorder = session.recorder;
    session.recorder = null;
    recorder?.dispose();
    const waveform = session.waveform;
    session.waveform = null;
    waveform?.dispose();
    const stream = session.stream;
    session.stream = null;
    stopTracks(stream);
  }

  #clearCaptureTimers(session: ActiveSession): void {
    if (session.durationTimer) this.#ports.clock.clearTimeout(session.durationTimer);
    if (session.maximumTimer) this.#ports.clock.clearTimeout(session.maximumTimer);
    session.durationTimer = null;
    session.maximumTimer = null;
  }

  #releaseMicrophoneLease(session: ActiveSession): void {
    if (!session.leaseAcquired) return;
    session.leaseAcquired = false;
    void this.#ports.lease.release(session.id).catch(() => undefined);
  }

  #isCurrent(session: ActiveSession): boolean {
    return !this.#disposed && this.#active === session && session.generation === this.#generation;
  }

  #publish(snapshot: DictationSessionSnapshot): void {
    if (Object.is(this.#snapshot, snapshot)) return;
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}

export const createNoopDictationStreamingPort = (): DictationControllerPorts["streaming"] => ({
  prepare: async () => ({
    start: async () => undefined,
    finish: async () => null,
    abort: () => undefined,
  }),
});

export const createNoopDictationHistoryPort = (): DictationControllerPorts["history"] => ({
  create: async () => undefined,
  append: async () => undefined,
  finalize: async () => undefined,
});
