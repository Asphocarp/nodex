import { describe, expect, test } from "vitest";
import { measurePreWrappedLineCount } from "./use-measured-text-collapse";

function measureByCharacterWidth(characterWidthPx: number) {
  return (value: string) => Array.from(value).length * characterWidthPx;
}

describe("measurePreWrappedLineCount", () => {
  test("counts explicit pre-wrap newlines as visual lines", () => {
    const measurement = measurePreWrappedLineCount({
      text: "first\nsecond\nthird",
      font: "13px sans-serif",
      lineHeightPx: 20,
      maxWidthPx: 200,
      measureTextWidth: measureByCharacterWidth(8),
    });

    expect(measurement?.lineCount).toBe(3);
    expect(measurement?.heightPx).toBe(60);
  });

  test("wraps long content by measured width", () => {
    const measurement = measurePreWrappedLineCount({
      text: "abcdefghij",
      font: "13px sans-serif",
      lineHeightPx: 18,
      maxWidthPx: 30,
      measureTextWidth: measureByCharacterWidth(10),
    });

    expect(measurement?.lineCount).toBe(4);
    expect(measurement?.heightPx).toBe(72);
  });

  test("wraps long unbroken words instead of undercounting them", () => {
    const measurement = measurePreWrappedLineCount({
      text: "supercalifragilistic",
      font: "13px sans-serif",
      lineHeightPx: 16,
      maxWidthPx: 40,
      measureTextWidth: measureByCharacterWidth(9),
    });

    expect(measurement?.lineCount === null).toBe(false);
    expect((measurement?.lineCount ?? 0) > 1).toBe(true);
  });

  test("returns null when canvas measurement is unavailable", () => {
    const getContextDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => null,
    });

    try {
      const measurement = measurePreWrappedLineCount({
        text: "text",
        font: "13px sans-serif",
        lineHeightPx: 20,
        maxWidthPx: 100,
      });

      expect(measurement).toBe(null);
    } finally {
      if (getContextDescriptor) {
        Object.defineProperty(HTMLCanvasElement.prototype, "getContext", getContextDescriptor);
      }
    }
  });
});
