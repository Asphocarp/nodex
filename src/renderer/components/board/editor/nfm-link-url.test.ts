import { describe, expect, test } from "vitest";
import { normalizeNfmEditorLinkUrl } from "./nfm-link-url";

describe("normalizeNfmEditorLinkUrl", () => {
  test("preserves absolute local paths", () => {
    expect(normalizeNfmEditorLinkUrl("/Users/asc/repo/abc")).toBe("/Users/asc/repo/abc");
    expect(normalizeNfmEditorLinkUrl("C:\\repo\\abc")).toBe("C:\\repo\\abc");
  });

  test("preserves explicit urls and relative references", () => {
    expect(normalizeNfmEditorLinkUrl("https://example.com")).toBe("https://example.com");
    expect(normalizeNfmEditorLinkUrl("mailto:test@example.com")).toBe("mailto:test@example.com");
    expect(normalizeNfmEditorLinkUrl("file:///Users/asc/repo/abc")).toBe(
      "file:///Users/asc/repo/abc",
    );
    expect(normalizeNfmEditorLinkUrl("./notes.md")).toBe("./notes.md");
    expect(normalizeNfmEditorLinkUrl("../notes.md")).toBe("../notes.md");
    expect(normalizeNfmEditorLinkUrl("#section")).toBe("#section");
    expect(normalizeNfmEditorLinkUrl("?tab=details")).toBe("?tab=details");
  });

  test("preserves protocol-less inputs exactly as entered", () => {
    expect(normalizeNfmEditorLinkUrl("example.com")).toBe("example.com");
    expect(normalizeNfmEditorLinkUrl("folder/abc/file")).toBe("folder/abc/file");
    expect(normalizeNfmEditorLinkUrl("www.example.com/docs")).toBe("www.example.com/docs");
  });

  test("trims surrounding whitespace only", () => {
    expect(normalizeNfmEditorLinkUrl("  folder/abc/file  ")).toBe("folder/abc/file");
    expect(normalizeNfmEditorLinkUrl("   ")).toBe("");
  });
});
