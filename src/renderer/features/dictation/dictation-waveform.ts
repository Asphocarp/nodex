import type { DictationControllerPorts } from "./dictation-session-controller";

const EMPTY_SESSION = { dispose: () => undefined };
const WAVEFORM_BUCKETS = 48;

export const browserDictationWaveformPort: DictationControllerPorts["waveform"] = {
  start(stream, onSamples) {
    if (typeof AudioContext === "undefined") return EMPTY_SESSION;
    let disposed = false;
    let animationFrame: number | null = null;
    let audioContext: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      audioContext = new AudioContext();
      source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const bins = new Uint8Array(analyser.frequencyBinCount);
      const render = (): void => {
        if (disposed || !analyser) return;
        analyser.getByteTimeDomainData(bins);
        const bucketSize = Math.max(1, Math.floor(bins.length / WAVEFORM_BUCKETS));
        const levels = Array.from({ length: WAVEFORM_BUCKETS }, (_, bucket) => {
          let peak = 0;
          const start = bucket * bucketSize;
          const end = Math.min(bins.length, start + bucketSize);
          for (let index = start; index < end; index += 1) {
            peak = Math.max(peak, Math.abs((bins[index] ?? 128) - 128) / 128);
          }
          return Math.max(0.04, Math.min(1, peak));
        });
        onSamples(levels);
        animationFrame = requestAnimationFrame(render);
      };
      animationFrame = requestAnimationFrame(render);
    } catch {
      void audioContext?.close();
      return EMPTY_SESSION;
    }

    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        source?.disconnect();
        analyser?.disconnect();
        void audioContext?.close();
        source = null;
        analyser = null;
        audioContext = null;
      },
    };
  },
};
