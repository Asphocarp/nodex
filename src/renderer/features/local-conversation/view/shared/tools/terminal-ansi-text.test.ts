import { describe, expect, test } from "vitest";
import {
  normalizeTerminalControlText,
  parseTerminalAnsiSegments,
} from "./terminal-ansi-text";

describe("terminal ANSI text", () => {
  test("applies carriage-return overwrites and destructive backspaces", () => {
    expect(normalizeTerminalControlText("progress 10%\rcomplete\nabc\b\bZ")).toBe(
      "complete 10%\naZ",
    );
    expect(normalizeTerminalControlText("ab\rX\bY")).toBe("Yb");
  });

  test("projects exact color classes while retaining unsupported palette and truecolor tokens", () => {
    const segments = parseTerminalAnsiSegments(
      "plain \u001b[31;1mred\u001b[0m \u001b[38;5;46mgreen\u001b[48;2;1;2;3m bg",
    );

    expect(segments.map((segment) => segment.text).join("|"))
      .toBe("plain |red| |green| bg");
    expect(segments[1]?.className).toBe("ansi-red-fg");
    expect(segments[1]?.style?.fontWeight).toBe("bold");
    expect(segments[3]?.className).toBe("ansi-palette-46-fg");
    expect(segments[4]?.className).toBe("ansi-palette-46-fg ansi-truecolor-bg");
    expect(segments.some((segment) => segment.text.includes("\u001b"))).toBe(false);
  });

  test("uses only the final active decoration and resolves reverse into color classes", () => {
    const segments = parseTerminalAnsiSegments(
      "\u001b[1;4munderlined\u001b[0;7mreversed",
    );

    expect(segments[0]?.style?.textDecorationLine).toBe("underline");
    expect(segments[0]?.style?.fontWeight).toBe(undefined);
    expect(segments[1]?.className).toBe("ansi-black-fg ansi-white-bg");
    expect(segments[1]?.style === undefined).toBe(false);
    expect(Object.keys(segments[1]?.style ?? { missing: true }).length).toBe(0);
    expect(parseTerminalAnsiSegments("\u001b[2mdim")[0]?.style?.opacity).toBe("0.5");
  });

  test("strips unsupported CSI controls without inheriting style onto that token", () => {
    const segments = parseTerminalAnsiSegments("\u001b[31mred\u001b[2Kplain\u001b[mtail");

    expect(segments.map((segment) => segment.text).join("|")).toBe("red|plain|tail");
    expect(segments[0]?.className).toBe("ansi-red-fg");
    expect(segments[1]?.className).toBe("");
    expect(segments[2]?.className).toBe("");
  });
});
