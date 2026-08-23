import type {
  DictationRecorderFactory,
  DictationRecorderHandle,
} from "./dictation-session-controller";

class BrowserDictationRecorder implements DictationRecorderHandle {
  readonly #recorder: MediaRecorder;
  readonly #stream: MediaStream;
  readonly #onChunk: (event: BlobEvent) => void;
  readonly #onError: (event: Event) => void;
  readonly #onStop: () => void;
  readonly #onTrackEnded: () => void;
  #disposed = false;

  constructor(
    stream: MediaStream,
    callbacks: {
      readonly onChunk: (chunk: Blob) => void;
      readonly onError: (error: unknown) => void;
      readonly onStop: () => void;
    },
  ) {
    this.#stream = stream;
    this.#recorder = new MediaRecorder(stream);
    this.#onChunk = (event) => callbacks.onChunk(event.data);
    this.#onError = (event) => callbacks.onError(event);
    this.#onStop = callbacks.onStop;
    this.#onTrackEnded = () =>
      callbacks.onError(new DOMException("Audio track ended", "AbortError"));
    this.#recorder.addEventListener("dataavailable", this.#onChunk);
    this.#recorder.addEventListener("error", this.#onError);
    this.#recorder.addEventListener("stop", this.#onStop);
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", this.#onTrackEnded, { once: true });
    }
  }

  get mimeType(): string {
    return this.#recorder.mimeType;
  }

  get state(): DictationRecorderHandle["state"] {
    return this.#recorder.state;
  }

  start(timesliceMs: number): void {
    this.#recorder.start(timesliceMs);
  }

  stop(): void {
    if (this.#recorder.state !== "inactive") this.#recorder.stop();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#recorder.removeEventListener("dataavailable", this.#onChunk);
    this.#recorder.removeEventListener("error", this.#onError);
    this.#recorder.removeEventListener("stop", this.#onStop);
    for (const track of this.#stream.getAudioTracks()) {
      track.removeEventListener("ended", this.#onTrackEnded);
    }
  }
}

export const browserDictationRecorderFactory: DictationRecorderFactory = {
  create: (stream, callbacks) => new BrowserDictationRecorder(stream, callbacks),
};
