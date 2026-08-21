import { describe, expect, test } from "vite-plus/test";
import {
  COMPOSER_DICTATION_WAVEFORM_BUFFER_DURATION_SECONDS,
  COMPOSER_DICTATION_WAVEFORM_SAMPLE_FLOOR,
  COMPOSER_DICTATION_WAVEFORM_SAMPLE_RATE_HZ,
  consumeComposerDictationWaveformSamples,
  normalizeComposerDictationWaveformSamples,
  resolveComposerDictationWaveformGeometry,
} from "./composer-dictation-waveform";

describe("composer dictation waveform", () => {
  test("maps the visible width to a ten-second sample window", () => {
    const geometry = resolveComposerDictationWaveformGeometry(574);

    expect(geometry).toEqual({
      bucketCount: 143,
      bucketSize: 3356,
    });

    const representedDurationSeconds =
      (geometry.bucketCount * geometry.bucketSize) / COMPOSER_DICTATION_WAVEFORM_SAMPLE_RATE_HZ;
    expect(representedDurationSeconds).toBeCloseTo(
      COMPOSER_DICTATION_WAVEFORM_BUFFER_DURATION_SECONDS,
      2,
    );
  });

  test.each([44_100, 96_000])(
    "preserves the ten-second window at a %i Hz device sample rate",
    (sampleRateHz) => {
      const geometry = resolveComposerDictationWaveformGeometry(574, sampleRateHz);
      const representedDurationSeconds =
        (geometry.bucketCount * geometry.bucketSize) / sampleRateHz;

      expect(representedDurationSeconds).toBeCloseTo(
        COMPOSER_DICTATION_WAVEFORM_BUFFER_DURATION_SECONDS,
        2,
      );
    },
  );

  test("advances by audio time instead of filling the waveform once per callback", () => {
    const geometry = resolveComposerDictationWaveformGeometry(574);
    const levels = Array.from(
      { length: geometry.bucketCount },
      () => COMPOSER_DICTATION_WAVEFORM_SAMPLE_FLOOR,
    );
    const firstSamples = new Float32Array(2048).fill(0.05);

    const firstResult = consumeComposerDictationWaveformSamples({
      bucketSize: geometry.bucketSize,
      levels,
      maxLevelCount: geometry.bucketCount,
      pendingSamples: new Float32Array(),
      samples: firstSamples,
    });
    expect(firstResult.appendedLevelCount).toBe(0);
    expect(firstResult.pendingSamples.length).toBe(2048);

    const secondResult = consumeComposerDictationWaveformSamples({
      bucketSize: geometry.bucketSize,
      levels,
      maxLevelCount: geometry.bucketCount,
      pendingSamples: firstResult.pendingSamples,
      samples: new Float32Array(2048).fill(0.05),
    });
    expect(secondResult.appendedLevelCount).toBe(1);
    expect(secondResult.pendingSamples.length).toBe(740);
    expect(levels.at(-1)).toBeCloseTo(0.05);
  });

  test("rectifies samples and preserves a visible silence floor", () => {
    const samples = Float32Array.from([-0.5, -0.001, 0, 0.25]);

    normalizeComposerDictationWaveformSamples(samples);

    expect(samples[0]).toBeCloseTo(0.5);
    expect(samples[1]).toBeCloseTo(COMPOSER_DICTATION_WAVEFORM_SAMPLE_FLOOR);
    expect(samples[2]).toBeCloseTo(COMPOSER_DICTATION_WAVEFORM_SAMPLE_FLOOR);
    expect(samples[3]).toBeCloseTo(0.25);
  });

  test("evicts the oldest bars as completed audio buckets arrive", () => {
    const levels = [0.01, 0.02];
    const result = consumeComposerDictationWaveformSamples({
      bucketSize: 2,
      levels,
      maxLevelCount: 2,
      pendingSamples: new Float32Array(),
      samples: Float32Array.from([0.3, 0.3, 0.4, 0.4]),
    });

    expect(result.appendedLevelCount).toBe(2);
    expect(result.pendingSamples.length).toBe(0);
    expect(levels[0]).toBeCloseTo(0.3);
    expect(levels[1]).toBeCloseTo(0.4);
  });
});
