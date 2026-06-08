import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { NodexTooltipProvider } from "../../../../components/ui/tooltip";
import { render } from "../../../../test/dom";
import { ThreadSummaryPanelToggle } from "./thread-summary-panel-toggle";

describe("ThreadSummaryPanelToggle", () => {
  test("matches the Codex pinned-summary button and icon contract", () => {
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
    const buttonClass = button.getAttribute("class") ?? "";
    const svg = button.querySelector("svg");
    const path = svg?.querySelector("path");

    expect(button.getAttribute("title")).toBe("Toggle pinned summary");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(buttonClass.includes("border-token-border")).toBeTrue();
    expect(buttonClass.includes("no-drag")).toBeTrue();
    expect(buttonClass.includes("cursor-interaction")).toBeTrue();
    expect(buttonClass.includes("select-none")).toBeTrue();
    expect(buttonClass.includes("h-token-button-composer")).toBeTrue();
    expect(buttonClass.includes("aspect-square")).toBeTrue();
    expect(buttonClass.includes("overflow-visible")).toBeTrue();
    expect(buttonClass.includes("bg-token-foreground/5")).toBeTrue();
    expect(svg?.getAttribute("width")).toBe("20");
    expect(svg?.getAttribute("height")).toBe("20");
    expect(svg?.getAttribute("fill")).toBe("currentColor");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(svg?.classList.contains("icon-sm")).toBeTrue();
    expect(svg?.classList.contains("shrink-0")).toBeTrue();
    expect(svg?.classList.contains("overflow-visible")).toBeTrue();
    expect(path?.getAttribute("d")?.startsWith("M5.693 11.056")).toBeTrue();

    fireEvent.click(button);
    expect(clickCount).toBe(1);
  });

  test("uses the Codex right-panel-open summary label without changing the icon contract", () => {
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
    const buttonClass = button.getAttribute("class") ?? "";
    const svg = button.querySelector("svg");
    const path = svg?.querySelector("path");

    expect(button.getAttribute("title")).toBe("Toggle summary");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(buttonClass.includes("text-token-text-tertiary")).toBeTrue();
    expect(buttonClass.includes("h-token-button-composer")).toBeTrue();
    expect(buttonClass.includes("overflow-visible")).toBeTrue();
    expect(svg?.classList.contains("icon-sm")).toBeTrue();
    expect(svg?.classList.contains("shrink-0")).toBeTrue();
    expect(path?.getAttribute("d")?.startsWith("M5.693 11.056")).toBeTrue();
  });
});
