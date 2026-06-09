import { describe, expect, test } from "bun:test";
import { isBlankBrowserUrl, normalizeBrowserNavigationUrl } from "./browser-url";

describe("browser URL helpers", () => {
  test("normalizes empty input to the blank browser page", () => {
    expect(normalizeBrowserNavigationUrl("")).toBe("about:blank");
    expect(normalizeBrowserNavigationUrl("   ")).toBe("about:blank");
    expect(isBlankBrowserUrl("about:blank")).toBeTrue();
  });

  test("normalizes localhost and hostnames without changing explicit schemes", () => {
    expect(normalizeBrowserNavigationUrl("localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeBrowserNavigationUrl("127.0.0.1:3000/path")).toBe("http://127.0.0.1:3000/path");
    expect(normalizeBrowserNavigationUrl("example.com")).toBe("https://example.com");
    expect(normalizeBrowserNavigationUrl("http://example.com")).toBe("http://example.com");
  });

  test("turns search-like input into a web search URL", () => {
    expect(normalizeBrowserNavigationUrl("codex browser tab")).toBe(
      "https://www.google.com/search?q=codex%20browser%20tab",
    );
  });
});

