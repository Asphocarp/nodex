import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, test, vi } from "vitest";
import { useContentOverflow } from "./use-content-overflow";

function OverflowHarness({ onMeasurement }: {
  readonly onMeasurement: (value: ReturnType<typeof useContentOverflow>) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const measurement = useContentOverflow(contentRef, 2);
  onMeasurement(measurement);

  return <div ref={contentRef}>Rendered content</div>;
}

describe("useContentOverflow", () => {
  test("classifies overflow from one layout-height read per scheduled pass", async () => {
    const scrollHeight = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(61);
    const getComputedStyle = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      fontSize: "13px",
      lineHeight: "20px",
    } as CSSStyleDeclaration);
    let latest: ReturnType<typeof useContentOverflow> | null = null;

    try {
      render(<OverflowHarness onMeasurement={(value) => { latest = value; }} />);
      await act(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });

      expect(latest).toEqual({ collapsedHeightPx: 40, isOverflowing: true });
      expect(scrollHeight).toHaveBeenCalledTimes(1);
      expect(getComputedStyle).toHaveBeenCalledTimes(1);
    } finally {
      scrollHeight.mockRestore();
      getComputedStyle.mockRestore();
    }
  });
});
