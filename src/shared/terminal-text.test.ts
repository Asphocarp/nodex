import { describe, expect, test } from "vitest";
import { applyTerminalTextDelta } from "./terminal-text";

const MAX_CHARS = 32_000;

describe("applyTerminalTextDelta", () => {
  test("preserves split CRLF and overwrites a line after a bare carriage return", () => {
    const pending = applyTerminalTextDelta({
      currentText: "first",
      delta: "\r",
      maxChars: MAX_CHARS,
    });
    expect(pending).toEqual({
      text: "first",
      carriageReturnPending: true,
      didTruncate: false,
    });

    const crlf = applyTerminalTextDelta({
      currentText: pending.text,
      delta: "\nsecond\rreplacement",
      carriageReturnPending: pending.carriageReturnPending,
      didTruncate: pending.didTruncate,
      maxChars: MAX_CHARS,
    });
    expect(crlf.text).toBe("first\nreplacement");
    expect(crlf.carriageReturnPending).toBe(false);
  });

  test("applies backspaces across delta boundaries", () => {
    const first = applyTerminalTextDelta({
      currentText: "",
      delta: "abc\b",
      maxChars: MAX_CHARS,
    });
    const second = applyTerminalTextDelta({
      currentText: first.text,
      delta: "\bZ",
      maxChars: MAX_CHARS,
      didTruncate: first.didTruncate,
    });

    expect(second.text).toBe("aZ");
  });

  test("retains only the newest characters from one oversized delta", () => {
    const result = applyTerminalTextDelta({
      currentText: "old",
      delta: "x".repeat(MAX_CHARS + 7),
      maxChars: MAX_CHARS,
    });

    expect(result.text).toBe("x".repeat(MAX_CHARS));
    expect(result.didTruncate).toBe(true);
  });

});
