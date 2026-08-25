import type { DictationControllerPorts } from "./dictation-session-controller";

const EMPTY_SESSION = { dispose: () => undefined };
const WAVEFORM_HISTORY_CAPACITY = 256;

export const DICTATION_SCROLL_WAVEFORM_SAMPLE_FLOOR = 0.0025;
export const DICTATION_SCROLL_WAVEFORM_NOISE_GATE = 0.006;
export const DICTATION_SCROLL_WAVEFORM_FULL_SCALE_RMS = 0.16;
export const DICTATION_SCROLL_WAVEFORM_RESPONSE_EXPONENT = 0.6;
export const DICTATION_SCROLL_WAVEFORM_ADVANCE_INTERVAL_MS = 200;

export function normalizeDictationScrollWaveformRms(rms: number): number {
  const aboveNoiseGate = Math.max(0, rms - DICTATION_SCROLL_WAVEFORM_NOISE_GATE);
  const normalized = Math.min(
    1,
    aboveNoiseGate /
      (DICTATION_SCROLL_WAVEFORM_FULL_SCALE_RMS - DICTATION_SCROLL_WAVEFORM_NOISE_GATE),
  );
  return normalized ** DICTATION_SCROLL_WAVEFORM_RESPONSE_EXPONENT;
}

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
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const levels: number[] = [];
      let accumulatedRms = 0;
      let rmsSampleCount = 0;
      let previousAdvanceAtMs = performance.now();
      const render = (): void => {
        if (disposed || !analyser) return;
        analyser.getFloatTimeDomainData(samples);
        let squaredAmplitude = 0;
        for (const sample of samples) squaredAmplitude += sample * sample;
        accumulatedRms += Math.sqrt(squaredAmplitude / Math.max(1, samples.length));
        rmsSampleCount += 1;

        const now = performance.now();
        const completedIntervals = Math.floor(
          (now - previousAdvanceAtMs) / DICTATION_SCROLL_WAVEFORM_ADVANCE_INTERVAL_MS,
        );
        if (completedIntervals > 0) {
          const nextLevel = normalizeDictationScrollWaveformRms(
            accumulatedRms / Math.max(1, rmsSampleCount),
          );
          for (let interval = 0; interval < completedIntervals; interval += 1) {
            levels.push(nextLevel);
            if (levels.length > WAVEFORM_HISTORY_CAPACITY) levels.shift();
          }
          accumulatedRms = 0;
          rmsSampleCount = 0;
          previousAdvanceAtMs += completedIntervals * DICTATION_SCROLL_WAVEFORM_ADVANCE_INTERVAL_MS;
          onSamples([...levels]);
        }
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
