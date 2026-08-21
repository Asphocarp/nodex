import { describe, expect, test } from "vite-plus/test";
import {
  clampWorkspacePdfPage,
  clampWorkspacePdfZoom,
  resolveWorkspacePdfPageSize,
  resolveWorkspacePdfZoomPercent,
  selectWorkspacePdfCurrentPage,
  stepWorkspacePdfZoom,
} from "./workspace-pdf-preview-model";

describe("workspace PDF preview model", () => {
  test("clamps and steps through the same broad zoom range as the preview runtime", () => {
    expect(clampWorkspacePdfZoom(0.1)).toBe(0.3);
    expect(clampWorkspacePdfZoom(20)).toBe(8);
    expect(stepWorkspacePdfZoom(1, "in")).toBe(1.1);
    expect(stepWorkspacePdfZoom(1, "out")).toBe(0.9);
  });

  test("fits a page to the available width while preserving its aspect ratio", () => {
    expect(
      resolveWorkspacePdfPageSize({
        baseSize: { width: 612, height: 792 },
        availableWidth: 306,
        fitToWidth: true,
        zoom: 3,
      }),
    ).toEqual({ width: 306, height: 396 });
    expect(
      resolveWorkspacePdfZoomPercent({
        baseWidth: 612,
        pageWidth: 306,
        fitToWidth: true,
        zoom: 3,
      }),
    ).toBe(50);
  });

  test("selects the most visible page, then falls back to the nearest page top", () => {
    expect(
      selectWorkspacePdfCurrentPage({
        containerTop: 100,
        pageTops: [100, 900, 1_700],
        visibilityRatios: [0.2, 0.8, 0],
      }),
    ).toBe(2);
    expect(
      selectWorkspacePdfCurrentPage({
        containerTop: 850,
        pageTops: [100, 900, 1_700],
        visibilityRatios: [0, 0, 0],
      }),
    ).toBe(2);
    expect(
      selectWorkspacePdfCurrentPage({ containerTop: 0, pageTops: [], visibilityRatios: [] }),
    ).toBeNull();
  });

  test("keeps page navigation inside the loaded document", () => {
    expect(clampWorkspacePdfPage(-1, 5)).toBe(1);
    expect(clampWorkspacePdfPage(8, 5)).toBe(5);
    expect(clampWorkspacePdfPage(1, 0)).toBe(1);
  });
});
