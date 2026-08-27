import { describe, expect, test } from "vite-plus/test";

import { sanitizeFileUrl, sanitizeUrl } from "./sanitizeUrl.js";

describe("sanitizeUrl", () => {
  test.each([
    ["https://example.com/docs", "https://example.com/docs"],
    ["http://example.com", "http://example.com/"],
    ["mailto:test@example.com", "mailto:test@example.com"],
    ["tel:+123456789", "tel:+123456789"],
    ["file:///Users/example/note.md", "file:///Users/example/note.md"],
    ["../next", "https://example.com/next"],
  ])("normalizes safe URL %s", (input, expected) => {
    expect(sanitizeUrl(input, "https://example.com/current/page")).toBe(expected);
  });

  test.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "blob:https://example.com/id",
    "app://fs/@fs/example/image.png",
    "unknown://example.com",
  ])("rejects unsafe URL %s", (input) => {
    expect(sanitizeUrl(input, "https://example.com/current/page")).toBe("#");
  });

  test("allows the read-only app filesystem protocol only for file downloads", () => {
    const appUrl = "app://fs/@fs/example/image.png";

    expect(sanitizeUrl(appUrl, "https://example.com")).toBe("#");
    expect(sanitizeFileUrl(appUrl, "https://example.com")).toBe(appUrl);
  });

  test.each([
    "app://-/index.html",
    "app://user:password@fs/@fs/example/image.png",
    "app://fs/static/image.png",
  ])("rejects non-filesystem app URL %s for file downloads", (input) => {
    expect(sanitizeFileUrl(input, "https://example.com")).toBe("#");
  });
});
