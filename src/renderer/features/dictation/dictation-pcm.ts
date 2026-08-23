export interface DictationPcmFrame {
  readonly pcm16: ArrayBuffer;
  readonly gain: number;
}

const TARGET_RMS = 0.063;
const SILENCE_RMS = 0.003;
const MAX_GAIN = 4;
const PEAK_CAP = 0.708;
const GAIN_ATTACK = 0.35;

/** Applies the reference gain envelope and encodes little-endian signed PCM16. */
export const encodeDictationPcm16 = (
  samples: Float32Array,
  previousGain = 1,
): DictationPcmFrame => {
  let squaredTotal = 0;
  let peak = 0;
  for (const sample of samples) {
    squaredTotal += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = samples.length > 0 ? Math.sqrt(squaredTotal / samples.length) : 0;
  const rmsGain = rms <= SILENCE_RMS ? 1 : Math.min(MAX_GAIN, TARGET_RMS / rms);
  const peakGain = peak <= 0 ? MAX_GAIN : PEAK_CAP / peak;
  const desiredGain = Math.max(0, Math.min(MAX_GAIN, rmsGain, peakGain));
  const gain = previousGain + (desiredGain - previousGain) * GAIN_ATTACK;
  const pcm16 = new ArrayBuffer(samples.length * 2);
  const view = new DataView(pcm16);
  for (let index = 0; index < samples.length; index += 1) {
    const normalized = Math.max(-1, Math.min(1, (samples[index] ?? 0) * gain));
    const encoded =
      normalized < 0 ? Math.round(normalized * 0x8000) : Math.round(normalized * 0x7fff);
    view.setInt16(index * 2, encoded, true);
  }
  return { pcm16, gain };
};
