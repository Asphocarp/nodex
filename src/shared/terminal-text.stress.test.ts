import { describe, expect, test } from "vite-plus/test";
import { applyTerminalTextDelta } from "./terminal-text";

const MAX_CHARS = 32_000;

describe("applyTerminalTextDelta stress", () => {
  test("bounds a ten-megabyte sequence of small deltas", () => {
    let state = applyTerminalTextDelta({
      currentText: "",
      delta: "",
      maxChars: MAX_CHARS,
    });
    const chunk = "0123456789".repeat(100);
    for (let index = 0; index < 10_000; index += 1) {
      state = applyTerminalTextDelta({
        currentText: state.text,
        delta: chunk,
        carriageReturnPending: state.carriageReturnPending,
        didTruncate: state.didTruncate,
        maxChars: MAX_CHARS,
      });
      expect(state.text.length).toBeLessThanOrEqual(MAX_CHARS);
    }

    expect(state.text.length).toBe(MAX_CHARS);
    expect(state.didTruncate).toBe(true);
  });
});
