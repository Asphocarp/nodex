import { describe, expect, test } from "vite-plus/test";

import {
  createGeneratedImageDotFieldConfig,
  resolveGeneratedImageDotFieldGridSpacing,
  resolveGeneratedImageDotFieldFrame,
} from "../../../user-attachment-image-editor/model/generated-image-loading-presentation";

describe("generated image dot field", () => {
  test("freezes all random channels into a once-per-mount configuration", () => {
    const config = createGeneratedImageDotFieldConfig(() => 0.5);

    expect(config.durations.offsetX1).toBe(6_345);
    expect(config.durations.fieldSize2).toBe(3_384);
    expect(config.phases).toEqual({
      offsetX1: 0.5,
      offsetY1: 0.5,
      offsetX2: 0.5,
      offsetY2: 0.5,
      fieldSize1: 0.5,
      fieldSize2: 0.5,
    });
    expect(config.bounds).toEqual({
      x1Start: 0.21000000000000002,
      x1End: 0.79,
      y1Start: 0.21000000000000002,
      y1End: 0.79,
      x2Start: 0.79,
      x2End: 0.21000000000000002,
      y2Start: 0.79,
      y2End: 0.21000000000000002,
    });
  });

  test("seeks to the same visible frame for the same elapsed time", () => {
    let value = 0;
    const config = createGeneratedImageDotFieldConfig(() => {
      value = (value + 0.137) % 1;
      return value;
    });

    const first = resolveGeneratedImageDotFieldFrame(8_250, config);
    const resumed = resolveGeneratedImageDotFieldFrame(8_250, config);

    expect(resumed).toEqual(first);
    expect(Object.values(first).every(Number.isFinite)).toBe(true);
    expect(first.firstSize).toBeGreaterThan(0);
    expect(first.secondSize).toBeGreaterThan(0);
  });

  test("uses device pixels only for the default field density", () => {
    expect(resolveGeneratedImageDotFieldGridSpacing("default", 2)).toBe(6);
    expect(resolveGeneratedImageDotFieldGridSpacing("single", 2)).toBe(6);
    expect(resolveGeneratedImageDotFieldGridSpacing("playground", 2)).toBe(14);
    expect(resolveGeneratedImageDotFieldGridSpacing("thumbnail", 2)).toBe(6);
  });
});
