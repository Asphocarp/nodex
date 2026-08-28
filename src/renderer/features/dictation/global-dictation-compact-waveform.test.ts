import { describe, expect, it } from "vitest";
import {
  advanceGlobalDictationCompactWaveform,
  GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR,
  normalizeGlobalDictationCompactRms,
  resolveGlobalDictationCompactBarRects,
} from "./global-dictation-compact-waveform";

describe("global dictation compact waveform", () => {
  it("gates room noise and reaches full response at the reference RMS", () => {
    expect(normalizeGlobalDictationCompactRms(0.006)).toBe(0);
    expect(normalizeGlobalDictationCompactRms(0.16)).toBe(1);
  });

  it("holds four quiet bars at the compact sample floor", () => {
    const next = advanceGlobalDictationCompactWaveform(
      {
        smoothedLevel: 0,
        phase: 0,
        bars: Array.from({ length: 4 }, () => GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR),
      },
      new Float32Array(2_048),
    );
    expect(next.phase).toBe(0.05);
    expect(next.bars).toEqual(
      Array.from({ length: 4 }, () => GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR),
    );
  });

  it("uses the reference attack, release, phase, and per-frame bar interpolation", () => {
    const initial = {
      smoothedLevel: 0,
      phase: 0,
      bars: Array.from({ length: 4 }, () => GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR),
    };
    const attack = advanceGlobalDictationCompactWaveform(
      initial,
      new Float32Array(2_048).fill(0.16),
    );
    const expectedDesired =
      GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR +
      0.085 * 0.36 * (0.9 + ((Math.sin(0.05) + 1) / 2) * 0.1);

    expect(attack.smoothedLevel).toBeCloseTo(0.085 * 0.36);
    expect(attack.phase).toBeCloseTo(0.05);
    expect(attack.bars[0]).toBeCloseTo(
      GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR * 0.5 + expectedDesired * 0.5,
    );

    const release = advanceGlobalDictationCompactWaveform(attack, new Float32Array(2_048));
    expect(release.smoothedLevel).toBeCloseTo(attack.smoothedLevel * 0.9);
    expect(release.phase).toBeCloseTo(0.1);
    expect(release.bars[0]).toBeGreaterThan(GLOBAL_DICTATION_COMPACT_SAMPLE_FLOOR);
  });

  it("draws four centered bars using the reference compact geometry", () => {
    const rects = resolveGlobalDictationCompactBarRects(108, 32, 2, [0.0025, 0.085, 0.0025, 0.085]);
    expect(rects).toHaveLength(4);
    expect(rects[0]?.x).toBeCloseTo(16.74);
    expect(rects[0]?.width).toBeCloseTo(12.96);
    expect(rects[0]).toMatchObject({ height: 6, alpha: 0.5 });
    expect(rects[1]?.x).toBeCloseTo(37.26);
    expect(rects[1]?.width).toBeCloseTo(12.96);
    expect(rects[1]?.height).toBeCloseTo(27.2);
    expect(rects[1]?.alpha).toBe(0.95);
    expect(rects[3]?.x).toBeCloseTo(78.3);
  });
});
