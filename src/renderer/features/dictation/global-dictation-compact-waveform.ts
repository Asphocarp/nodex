import type { DictationControllerPorts } from "./dictation-session-controller";

export const GLOBAL_DICTATION_COMPACT_BAR_COUNT = 4;
export const GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR = 0.0025;
export const GLOBAL_DICTATION_COMPACT_NOISE_GATE = 0.006;
export const GLOBAL_DICTATION_COMPACT_FULL_SCALE_RMS = 0.16;
export const GLOBAL_DICTATION_COMPACT_MAX_LEVEL = 0.085;

const EMPTY_SESSION = { dispose: () => undefined };
const ATTACK = 0.36;
const RELEASE = 0.1;
const BAR_LERP = 0.5;
const PHASE_ADVANCE = 0.05;

export interface GlobalDictationCompactWaveformState {
  readonly smoothedLevel: number;
  readonly phase: number;
  readonly bars: readonly number[];
}

export function normalizeGlobalDictationCompactRms(rms: number): number {
  const aboveNoiseGate = Math.max(0, rms - GLOBAL_DICTATION_COMPACT_NOISE_GATE);
  const normalized = Math.min(
    1,
    aboveNoiseGate /
      (GLOBAL_DICTATION_COMPACT_FULL_SCALE_RMS - GLOBAL_DICTATION_COMPACT_NOISE_GATE),
  );
  return normalized ** 0.6;
}

function compactBandRatio(
  samples: Float32Array,
  index: number,
  count: number,
  frameRms: number,
): number {
  const bandSize = Math.max(1, Math.floor(samples.length / count));
  const start = Math.min(Math.max(0, samples.length - bandSize), index * bandSize);
  let squaredAmplitude = 0;
  for (let sampleIndex = start; sampleIndex < start + bandSize; sampleIndex += 1) {
    const sample = samples[sampleIndex] ?? GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR;
    squaredAmplitude += sample * sample;
  }
  const bandRms = Math.sqrt(squaredAmplitude / bandSize);
  const ratio = frameRms <= GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR ? 1 : bandRms / frameRms;
  return Math.min(1.14, Math.max(0.86, ratio));
}

export function advanceGlobalDictationCompactWaveform(
  previous: GlobalDictationCompactWaveformState,
  input: Float32Array,
): GlobalDictationCompactWaveformState {
  let squaredAmplitude = 0;
  const samples = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const absolute = Math.abs(input[index] ?? 0);
    squaredAmplitude += absolute * absolute;
    samples[index] = Math.max(GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR, absolute);
  }

  const rms = Math.sqrt(squaredAmplitude / Math.max(1, input.length));
  const target = normalizeGlobalDictationCompactRms(rms) * GLOBAL_DICTATION_COMPACT_MAX_LEVEL;
  const response = target > previous.smoothedLevel ? ATTACK : RELEASE;
  const smoothedLevel = previous.smoothedLevel * (1 - response) + target * response;
  const phase = previous.phase + PHASE_ADVANCE;
  const bars = Array.from({ length: GLOBAL_DICTATION_COMPACT_BAR_COUNT }, (_, index) => {
    const phaseScale = 0.9 + ((Math.sin(phase - index * 0.8) + 1) / 2) * 0.1;
    const bandRatio = compactBandRatio(samples, index, GLOBAL_DICTATION_COMPACT_BAR_COUNT, rms);
    const desired = Math.min(
      GLOBAL_DICTATION_COMPACT_MAX_LEVEL,
      GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR + smoothedLevel * phaseScale * bandRatio,
    );
    const current = previous.bars[index] ?? GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR;
    return current * (1 - BAR_LERP) + desired * BAR_LERP;
  });

  return { smoothedLevel, phase, bars };
}

export interface GlobalDictationCompactBarRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly alpha: number;
}

export function resolveGlobalDictationCompactBarRects(
  width: number,
  height: number,
  devicePixelRatio: number,
  levels: readonly number[],
): readonly GlobalDictationCompactBarRect[] {
  const count = Math.max(1, levels.length);
  const slot = width / count;
  const barWidth = slot * 0.48;
  const gap = slot * 0.28;
  const contentWidth = barWidth * count + gap * (count - 1);
  const startX = (width - contentWidth) / 2;
  const halfHeight = height / 2;

  return levels.map((level, index) => {
    const drawnHalfHeight = Math.max(1.5 * devicePixelRatio, level * 10 * halfHeight);
    return {
      x: startX + index * (barWidth + gap),
      y: halfHeight - drawnHalfHeight,
      width: barWidth,
      height: drawnHalfHeight * 2,
      radius: Math.min(barWidth / 2, drawnHalfHeight),
      alpha: level <= GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR ? 0.5 : 0.95,
    };
  });
}

export const browserGlobalDictationCompactWaveformPort: DictationControllerPorts["waveform"] = {
  start(stream, onSamples) {
    if (typeof AudioContext === "undefined") return EMPTY_SESSION;
    let audioContext: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let state: GlobalDictationCompactWaveformState = {
      smoothedLevel: 0,
      phase: 0,
      bars: Array.from(
        { length: GLOBAL_DICTATION_COMPACT_BAR_COUNT },
        () => GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR,
      ),
    };

    try {
      audioContext = new AudioContext();
      source = audioContext.createMediaStreamSource(stream);
      processor = audioContext.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = (event) => {
        state = advanceGlobalDictationCompactWaveform(state, event.inputBuffer.getChannelData(0));
        onSamples([...state.bars]);
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch {
      processor?.disconnect();
      source?.disconnect();
      void audioContext?.close();
      return EMPTY_SESSION;
    }

    return {
      dispose: () => {
        if (!audioContext) return;
        if (processor) {
          processor.onaudioprocess = null;
          processor.disconnect();
        }
        source?.disconnect();
        void audioContext.close();
        processor = null;
        source = null;
        audioContext = null;
      },
    };
  },
};
