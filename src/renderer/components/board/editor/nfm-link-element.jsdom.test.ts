import { describe, expect, test, vi } from "vite-plus/test";
import { readNfmLinkHrefAtElement } from "./nfm-link-element";

describe("readNfmLinkHrefAtElement", () => {
  test("reads the canonical Page href from the editor when the DOM href was cleared", () => {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "");
    const posAtDOM = vi.fn(() => 12);
    const getLinkMarkAtPos = vi.fn(() => ({
      href: "nodex://pages/018f47b1-93e1-7a25-b58e-8d9018a460d3",
    }));

    expect(
      readNfmLinkHrefAtElement(
        {
          prosemirrorView: { posAtDOM },
          getLinkMarkAtPos,
        },
        anchor,
      ),
    ).toBe("nodex://pages/018f47b1-93e1-7a25-b58e-8d9018a460d3");
    expect(posAtDOM).toHaveBeenCalledWith(anchor, 0);
    expect(getLinkMarkAtPos).toHaveBeenCalledWith(13);
  });

  test("falls back to the rendered href when no editor mark is present", () => {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "https://example.com/docs");

    expect(
      readNfmLinkHrefAtElement(
        {
          prosemirrorView: { posAtDOM: () => 4 },
          getLinkMarkAtPos: () => undefined,
        },
        anchor,
      ),
    ).toBe("https://example.com/docs");
  });
});
