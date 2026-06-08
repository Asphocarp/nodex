import { describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { render } from "@/test/dom";
import {
  NodexTooltip,
  NodexTooltipProvider,
  dismissNodexTooltips,
} from "./tooltip";

describe("codex tooltip", () => {
  function tooltipIsMounted() {
    return document.body.querySelector('[role="tooltip"]') !== null;
  }

  async function renderOpenTooltip() {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(
        <NodexTooltipProvider>
          <NodexTooltip tooltipContent="Shared tooltip body" defaultOpen>
            <button type="button">Hover me</button>
          </NodexTooltip>
        </NodexTooltipProvider>,
      );
    });

    return view;
  }

  test("returns the child directly when disabled", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(
        <NodexTooltipProvider>
          <NodexTooltip tooltipContent="Shared tooltip body" disabled>
            <button type="button">Hover me</button>
          </NodexTooltip>
        </NodexTooltipProvider>,
      );
    });

    expect(view.getByText("Hover me").tagName).toBe("BUTTON");
    expect(tooltipIsMounted()).toBeFalse();

    await act(async () => {
      dismissNodexTooltips();
    });

    expect(tooltipIsMounted()).toBeFalse();
  });

  test("dismisses an open uncontrolled tooltip through the shared dismiss event", async () => {
    await renderOpenTooltip();

    expect(tooltipIsMounted()).toBeTrue();

    await act(async () => {
      dismissNodexTooltips();
    });

    expect(tooltipIsMounted()).toBeFalse();
  });

  test("dismisses open tooltips when the window blurs", async () => {
    await renderOpenTooltip();

    expect(tooltipIsMounted()).toBeTrue();

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(tooltipIsMounted()).toBeFalse();
  });

  test("dismisses open tooltips when the document becomes hidden", async () => {
    await renderOpenTooltip();

    expect(tooltipIsMounted()).toBeTrue();

    const originalVisibilityState = document.visibilityState;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    try {
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    } finally {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: originalVisibilityState,
      });
    }

    expect(tooltipIsMounted()).toBeFalse();
  });

  test("notifies controlled tooltips when global dismissal requests close", async () => {
    const openChanges: boolean[] = [];

    function ControlledTooltip() {
      const [isOpen, setIsOpen] = useState(true);

      return (
        <NodexTooltipProvider>
          <NodexTooltip
            tooltipContent="Shared tooltip body"
            open={isOpen}
            onOpenChange={(nextOpen) => {
              openChanges.push(nextOpen);
              setIsOpen(nextOpen);
            }}
          >
            <button type="button">Hover me</button>
          </NodexTooltip>
        </NodexTooltipProvider>
      );
    }

    await act(async () => {
      render(<ControlledTooltip />);
    });

    expect(tooltipIsMounted()).toBeTrue();

    await act(async () => {
      dismissNodexTooltips();
    });

    expect(openChanges.length).toBe(1);
    expect(openChanges[0]).toBeFalse();
    expect(tooltipIsMounted()).toBeFalse();
  });
});
