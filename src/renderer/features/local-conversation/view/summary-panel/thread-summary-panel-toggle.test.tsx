import { describe, expect, test } from "vite-plus/test";
import { fireEvent } from "@testing-library/react";
import { NodexTooltipProvider } from "../../../../components/ui/tooltip";
import { render } from "../../../../test/dom";
import { ThreadSummaryPanelToggle } from "./thread-summary-panel-toggle";

describe("ThreadSummaryPanelToggle", () => {
  test("renders the pinned-summary button state and emits clicks", () => {
    let clickCount = 0;
    const view = render(
      <NodexTooltipProvider>
        <ThreadSummaryPanelToggle
          pressed
          onClick={() => {
            clickCount += 1;
          }}
        />
      </NodexTooltipProvider>,
    );

    const button = view.getByRole("button", { name: "Toggle pinned summary" });
    const svg = button.querySelector("svg");
    const path = svg?.querySelector("path");

    expect(button.hasAttribute("title")).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(svg?.getAttribute("width")).toBe("20");
    expect(svg?.getAttribute("height")).toBe("20");
    expect(svg?.getAttribute("fill")).toBe("currentColor");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(path?.getAttribute("d")?.startsWith("M5.693 11.056")).toBe(true);

    fireEvent.click(button);
    expect(clickCount).toBe(1);
  });

  test("uses the right-panel-open summary label", () => {
    const view = render(
      <NodexTooltipProvider>
        <ThreadSummaryPanelToggle
          label="Toggle summary"
          pressed={false}
          onClick={() => undefined}
        />
      </NodexTooltipProvider>,
    );

    const button = view.getByRole("button", { name: "Toggle summary" });
    const svg = button.querySelector("svg");
    const path = svg?.querySelector("path");

    expect(button.hasAttribute("title")).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(path?.getAttribute("d")?.startsWith("M5.693 11.056")).toBe(true);
  });
});
