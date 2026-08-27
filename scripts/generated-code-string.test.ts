import { describe, expect, test } from "vite-plus/test";

import { serializeGeneratedCodeString } from "./generated-code-string.mjs";

describe("serializeGeneratedCodeString", () => {
  test("round-trips source text without emitting script-breaking characters", () => {
    const value = `</script>\u2028line separator\u2029"quoted"\\path`;
    const literal = serializeGeneratedCodeString(value);

    expect(JSON.parse(literal)).toBe(value);
    expect(literal).not.toMatch(/[<>\u2028\u2029]/u);
  });

  test("rejects non-string values at the generated-code boundary", () => {
    expect(() => serializeGeneratedCodeString({ source: "catalog" })).toThrow(
      "Generated code string values must be strings",
    );
  });
});
