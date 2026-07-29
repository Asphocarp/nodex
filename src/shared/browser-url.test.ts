import { describe, expect, test } from "vitest";
import {
  isAllowedBrowserExternalUrl,
  isAllowedBrowserNavigationUrl,
  isBlankBrowserUrl,
  normalizeBrowserNavigationUrl,
} from "./browser-url";

describe("browser URL helpers", () => {
  test("normalizes empty input to the blank browser page", () => {
    expect(normalizeBrowserNavigationUrl("")).toBe("about:blank");
    expect(normalizeBrowserNavigationUrl("   ")).toBe("about:blank");
    expect(isBlankBrowserUrl("about:blank")).toBe(true);
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

  test("allows only explicit Browser navigation and external URL schemes", () => {
    expect(isAllowedBrowserNavigationUrl("about:blank")).toBe(true);
    expect(isAllowedBrowserNavigationUrl("https://example.com/")).toBe(true);
    expect(isAllowedBrowserNavigationUrl("chrome://extensions")).toBe(true);
    expect(isAllowedBrowserNavigationUrl("chrome://flags")).toBe(false);
    expect(isAllowedBrowserNavigationUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedBrowserNavigationUrl("data:text/html,test")).toBe(false);
    expect(isAllowedBrowserNavigationUrl("file:///tmp/secret")).toBe(false);
    expect(
      isAllowedBrowserNavigationUrl("https://user:secret@example.com/private"),
    ).toBe(false);

    expect(isAllowedBrowserExternalUrl("mailto:hello@example.com")).toBe(true);
    expect(isAllowedBrowserExternalUrl("https://example.com/")).toBe(true);
    expect(
      isAllowedBrowserExternalUrl("https://user:secret@example.com/private"),
    ).toBe(false);
    expect(isAllowedBrowserExternalUrl("file:///tmp/secret")).toBe(false);
  });
});
