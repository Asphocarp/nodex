import { describe, expect, test } from "vitest";
import { calculateGeneratedImageGalleryLayout } from "./generated-image-gallery-layout";

describe("calculateGeneratedImageGalleryLayout", () => {
  test("uses a natural single-image aspect ratio", () => {
    expect(
      calculateGeneratedImageGalleryLayout({
        containerWidthPx: 400,
        imageAspectRatios: [2],
      }),
    ).toEqual({
      heightPx: 200,
      aspectRatio: "natural",
      maxStartIndex: 0,
      overflowCount: 0,
      visibleCount: 1,
    });
  });

  test("falls back to a four-slot square carousel when natural widths overflow", () => {
    expect(
      calculateGeneratedImageGalleryLayout({
        containerWidthPx: 400,
        imageAspectRatios: [2, 2, 2, 2, 2],
      }),
    ).toEqual({
      heightPx: 94,
      aspectRatio: "square",
      maxStartIndex: 1,
      overflowCount: 1,
      visibleCount: 4,
    });
  });

  test("reserves four slots while generation is pending", () => {
    const layout = calculateGeneratedImageGalleryLayout({
      containerWidthPx: 400,
      imageAspectRatios: [1],
      minimumSlotCount: 4,
    });

    expect(layout.heightPx).toBe(94);
    expect(layout.aspectRatio).toBe("natural");
  });
});
