export const COMPOSER_DICTATION_WAVEFORM_BUFFER_DURATION_SECONDS = 10;
export const COMPOSER_DICTATION_WAVEFORM_SAMPLE_RATE_HZ = 48_000;
export const COMPOSER_DICTATION_WAVEFORM_BAR_PITCH_PX = 4;
export const COMPOSER_DICTATION_WAVEFORM_SAMPLE_FLOOR = 0.0025;

export interface ComposerDictationWaveformGeometry {
  bucketCount: number;
  bucketSize: number;
}

export interface ConsumeComposerDictationWaveformSamplesInput {
  bucketSize: number;
  levels: number[];
  maxLevelCount: number;
  pendingSamples: Float32Array;
  samples: Float32Array;
}

export interface ConsumeComposerDictationWaveformSamplesResult {
  appendedLevelCount: number;
  pendingSamples: Float32Array;
}

export function resolveComposerDictationWaveformGeometry(
  clientWidth: number,
  sampleRateHz = COMPOSER_DICTATION_WAVEFORM_SAMPLE_RATE_HZ,
): ComposerDictationWaveformGeometry {
  const effectiveSampleRateHz =
    Number.isFinite(sampleRateHz) && sampleRateHz > 0
      ? sampleRateHz
      : COMPOSER_DICTATION_WAVEFORM_SAMPLE_RATE_HZ;
  const bucketCount = Math.max(
    1,
    Math.floor(clientWidth / COMPOSER_DICTATION_WAVEFORM_BAR_PITCH_PX),
  );
  const bucketSize = Math.max(
    1,
    Math.floor(
      (effectiveSampleRateHz * COMPOSER_DICTATION_WAVEFORM_BUFFER_DURATION_SECONDS) / bucketCount,
    ),
  );

  return { bucketCount, bucketSize };
}

export function normalizeComposerDictationWaveformSamples(samples: Float32Array): void {
  for (let index = 0; index < samples.length; index += 1) {
    const amplitude = Math.abs(samples[index] ?? 0);
    samples[index] =
      amplitude < COMPOSER_DICTATION_WAVEFORM_SAMPLE_FLOOR
        ? COMPOSER_DICTATION_WAVEFORM_SAMPLE_FLOOR
        : amplitude;
  }
}

export function consumeComposerDictationWaveformSamples({
  bucketSize,
  levels,
  maxLevelCount,
  pendingSamples,
  samples,
}: ConsumeComposerDictationWaveformSamplesInput): ConsumeComposerDictationWaveformSamplesResult {
  const combinedSamples = new Float32Array(pendingSamples.length + samples.length);
  combinedSamples.set(pendingSamples, 0);
  combinedSamples.set(samples, pendingSamples.length);

  if (maxLevelCount <= 0 || bucketSize <= 0) {
    return {
      appendedLevelCount: 0,
      pendingSamples: combinedSamples,
    };
  }

  let appendedLevelCount = 0;
  let offset = 0;
  while (offset + bucketSize <= combinedSamples.length) {
    const end = offset + bucketSize;
    let total = 0;
    for (let sampleIndex = offset; sampleIndex < end; sampleIndex += 1) {
      total += combinedSamples[sampleIndex] ?? 0;
    }

    levels.push(total / bucketSize);
    if (levels.length > maxLevelCount) {
      levels.shift();
    }
    appendedLevelCount += 1;
    offset = end;
  }

  return {
    appendedLevelCount,
    pendingSamples: combinedSamples.slice(offset),
  };
}
