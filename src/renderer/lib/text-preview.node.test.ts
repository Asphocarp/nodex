import { describe, expect, test } from "vite-plus/test";
import { buildTextPreview } from "./text-preview";

describe("buildTextPreview", () => {
  test("returns complete content at the inclusive boundary", () => {
    expect(buildTextPreview("12345", 5)).toEqual({ kind: "complete", text: "12345" });
  });

  test("builds a bounded head and tail projection with an exact omission count", () => {
    const source = `${"a".repeat(80)}${"z".repeat(80)}`;
    const preview = buildTextPreview(source, 80);

    expect(preview.kind).toBe("omitted");
    expect(preview.text).toHaveLength(80);
    expect(preview.text).toMatch(/^a+/);
    expect(preview.text).toMatch(/z+$/);
    if (preview.kind !== "omitted") throw new Error("Expected omitted preview");
    expect(preview.text).toContain(preview.omittedCharacters.toLocaleString("en-US"));
    expect(preview.omittedCharacters).toBe(
      source.length -
        (preview.text.length -
          `\n… ${preview.omittedCharacters.toLocaleString("en-US")} characters omitted …\n`.length),
    );
  });

  test("never exceeds a very small requested budget", () => {
    const preview = buildTextPreview("abcdefghij", 4);
    expect(preview.text).toHaveLength(4);
    expect(preview.kind).toBe("omitted");
  });

  test("rejects invalid limits", () => {
    expect(() => buildTextPreview("value", -1)).toThrow(RangeError);
  });
});
