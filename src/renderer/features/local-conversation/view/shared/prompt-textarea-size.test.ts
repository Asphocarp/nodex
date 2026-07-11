import { describe, expect, test } from "vitest";
import { resolvePromptTextareaSize } from "./prompt-textarea-size";

describe("resolvePromptTextareaSize", () => {
  test("returns zero height for invalid scroll heights", () => {
    const fromZero = resolvePromptTextareaSize({ scrollHeight: 0, maxHeightPx: 240 });
    expect(fromZero.heightPx).toBe(0);
    expect(fromZero.hasOverflow).toBe(false);

    const fromNaN = resolvePromptTextareaSize({ scrollHeight: Number.NaN, maxHeightPx: 240 });
    expect(fromNaN.heightPx).toBe(0);
    expect(fromNaN.hasOverflow).toBe(false);
  });

  test("clamps height to max and enables overflow when content exceeds max", () => {
    const result = resolvePromptTextareaSize({ scrollHeight: 500, maxHeightPx: 240 });
    expect(result.heightPx).toBe(240);
    expect(result.hasOverflow).toBe(true);
  });

  test("uses content height when within max", () => {
    const result = resolvePromptTextareaSize({ scrollHeight: 160, maxHeightPx: 240 });
    expect(result.heightPx).toBe(160);
    expect(result.hasOverflow).toBe(false);
  });
});
