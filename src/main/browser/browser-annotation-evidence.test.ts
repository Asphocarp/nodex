import { describe, expect, test } from "vite-plus/test";
import type { BrowserAnnotationAnchor } from "../../shared/browser-annotation";
import { computeBrowserAnnotationEvidenceCrop } from "./browser-annotation-evidence";

function anchor(rect: BrowserAnnotationAnchor["rect"]): BrowserAnnotationAnchor {
  return {
    id: crypto.randomUUID(),
    kind: "region",
    pageUrl: "https://example.com/",
    rect,
  };
}

describe("computeBrowserAnnotationEvidenceCrop", () => {
  test("maps viewport coordinates into captured-image pixels", () => {
    expect(
      computeBrowserAnnotationEvidenceCrop({
        anchors: [anchor({ x: 100, y: 50, width: 200, height: 100 })],
        imageSize: { width: 2_000, height: 1_000 },
        viewport: { width: 1_000, height: 500 },
        padding: 20,
      }),
    ).toEqual({
      x: 180,
      y: 80,
      width: 440,
      height: 240,
    });
  });

  test("unions multiple anchors and clamps the crop to image bounds", () => {
    expect(
      computeBrowserAnnotationEvidenceCrop({
        anchors: [
          anchor({ x: -10, y: -5, width: 30, height: 20 }),
          anchor({ x: 90, y: 80, width: 30, height: 40 }),
        ],
        imageSize: { width: 100, height: 100 },
        viewport: { width: 100, height: 100 },
        padding: 10,
      }),
    ).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  test("rejects empty, invalid, or fully out-of-frame evidence", () => {
    expect(
      computeBrowserAnnotationEvidenceCrop({
        anchors: [],
        imageSize: { width: 100, height: 100 },
        viewport: { width: 100, height: 100 },
      }),
    ).toBeNull();
    expect(
      computeBrowserAnnotationEvidenceCrop({
        anchors: [anchor({ x: 1, y: 1, width: 2, height: 2 })],
        imageSize: { width: 0, height: 100 },
        viewport: { width: 100, height: 100 },
      }),
    ).toBeNull();
    expect(
      computeBrowserAnnotationEvidenceCrop({
        anchors: [anchor({ x: 200, y: 200, width: 10, height: 10 })],
        imageSize: { width: 100, height: 100 },
        viewport: { width: 100, height: 100 },
        padding: 0,
      }),
    ).toBeNull();
  });
});
