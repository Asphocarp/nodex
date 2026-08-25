import { describe, expect, test } from "vite-plus/test";
import {
  COMPOSER_DICTATION_WAVEFORM_ADVANCE_INTERVAL_MS,
  COMPOSER_DICTATION_WAVEFORM_SAMPLE_FLOOR,
  appendComposerDictationWaveformLevel,
  normalizeComposerDictationRms,
  resolveComposerDictationWaveformGeometry,
} from "./composer-dictation-waveform";

describe("composer dictation waveform", () => {
  test("uses the reference three-pixel bars and fixed 30px/s advance", () => {
    const geometry = resolveComposerDictationWaveformGeometry(574);

    expect(geometry).toEqual({
      barCount: 96,
      barPitchPx: 6,
      barWidthPx: 3,
      historyDurationMs: 19_200,
      scrollSpeedPxPerSecond: 30,
    });
    expect(COMPOSER_DICTATION_WAVEFORM_ADVANCE_INTERVAL_MS).toBe(200);
  });

  test("applies the noise gate and reference nonlinear response", () => {
    expect(normalizeComposerDictationRms(0)).toBe(0);
    expect(normalizeComposerDictationRms(0.006)).toBe(0);
    expect(normalizeComposerDictationRms(0.16)).toBe(1);
    expect(normalizeComposerDictationRms(0.05)).toBeCloseTo(0.4717, 3);
  });

  test("advances one history level at a time and evicts the oldest", () => {
    const levels = [COMPOSER_DICTATION_WAVEFORM_SAMPLE_FLOOR, 0.2];

    appendComposerDictationWaveformLevel(levels, 0.16, 2);

    expect(levels).toEqual([0.2, 1]);
  });
});
