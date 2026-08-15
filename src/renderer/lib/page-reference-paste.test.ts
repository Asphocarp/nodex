import { describe, expect, test } from "vitest";
import { resolvePageDeepLinkPasteIntent } from "./page-reference-paste";

const base = {
  plainText: "nodex://pages/page-1",
  hasStructuredClipboard: false,
  hasFiles: false,
  hasTextSelection: false,
  currentBlockType: "paragraph",
  currentBlockIsEmpty: false,
} as const;

describe("resolvePageDeepLinkPasteIntent", () => {
  test("maps one canonical Page deeplink by editor context", () => {
    expect(
      resolvePageDeepLinkPasteIntent({ ...base, hasTextSelection: true }),
    ).toEqual({
      kind: "link",
      href: base.plainText,
      pageId: "page-1",
    });
    expect(resolvePageDeepLinkPasteIntent(base)).toEqual({
      kind: "mention",
      pageId: "page-1",
    });
    expect(
      resolvePageDeepLinkPasteIntent({ ...base, currentBlockIsEmpty: true }),
    ).toEqual({ kind: "reference_block", pageId: "page-1" });
  });

  test("keeps code, rich clipboard, files, and non-canonical text literal", () => {
    expect(
      resolvePageDeepLinkPasteIntent({
        ...base,
        currentBlockType: "codeBlock",
      }),
    ).toBeNull();
    expect(
      resolvePageDeepLinkPasteIntent({
        ...base,
        hasStructuredClipboard: true,
      }),
    ).toBeNull();
    expect(
      resolvePageDeepLinkPasteIntent({ ...base, hasFiles: true }),
    ).toBeNull();
    expect(
      resolvePageDeepLinkPasteIntent({
        ...base,
        plainText: " nodex://pages/page-1",
      }),
    ).toBeNull();
    expect(
      resolvePageDeepLinkPasteIntent({
        ...base,
        plainText: "nodex:/pages/page-1",
      }),
    ).toBeNull();
  });
});
