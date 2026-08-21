import { describe, expect, test } from "vite-plus/test";
import { parseExternalNavigationUrl } from "./external-navigation";

describe("parseExternalNavigationUrl", () => {
  test("normalizes credential-free web links", () => {
    expect(parseExternalNavigationUrl("https://example.com/spec#page=2").toString()).toBe(
      "https://example.com/spec#page=2",
    );
    expect(parseExternalNavigationUrl("http://localhost:3000/docs").toString()).toBe(
      "http://localhost:3000/docs",
    );
  });

  test.each([
    "file:///tmp/report.pdf",
    "javascript:alert(1)",
    "https://user:secret@example.com/private",
  ])("rejects an unsafe external target: %s", (value) => {
    expect(() => parseExternalNavigationUrl(value)).toThrow(
      "External navigation requires a credential-free HTTP(S) URL",
    );
  });

  test("rejects unbounded URLs", () => {
    expect(() => parseExternalNavigationUrl(`https://example.com/${"x".repeat(8_192)}`)).toThrow(
      "External URL is too long",
    );
  });
});
