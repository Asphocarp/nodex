import { describe, expect, test } from "vitest";
import { buildLoadingResultsWidths } from "./loading-results-shimmer-model";

describe("LoadingResultsShimmer widths", () => {
  test("matches the frozen hash and LCG sequence", () => {
    expect(
      buildLoadingResultsWidths({
        count: 3,
        minWidth: 55,
        maxWidth: 100,
        seed: "shimmer-lines",
      }),
    ).toEqual([90.08444845447525, 86.41134597426809, 82.08152389483598]);
  });

  test("clamps, orders, and bounds inputs", () => {
    const widths = buildLoadingResultsWidths({
      count: 4,
      minWidth: 120,
      maxWidth: -5,
      seed: "bounds",
    });

    expect(widths).toHaveLength(4);
    expect(widths.every((width) => width >= 1 && width <= 100)).toBe(true);
    expect(
      buildLoadingResultsWidths({
        count: -1,
        minWidth: 55,
        maxWidth: 100,
        seed: "none",
      }),
    ).toEqual([]);
  });
});
