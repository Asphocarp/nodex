import { describe, expect, test } from "vite-plus/test";
import { fireEvent } from "@testing-library/react";
import { act, useEffect, useState } from "react";
import { render } from "@/test/dom";
import { NodexTooltip, NodexTooltipProvider, dismissNodexTooltips } from "./tooltip";

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

  test("supports isolated product surfaces without a provider wrapper", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(
        <NodexTooltip tooltipContent="Standalone tooltip" defaultOpen>
          <button type="button">Standalone trigger</button>
        </NodexTooltip>,
      );
    });

    expect(view.getByText("Standalone trigger").tagName).toBe("BUTTON");
    expect(view.getByRole("tooltip").textContent).toContain("Standalone tooltip");
  });

  test("keeps disabled tooltip content hidden", async () => {
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
    expect(view.getByText("Hover me").getAttribute("aria-describedby")).toBeNull();
    expect(tooltipIsMounted()).toBe(false);

    await act(async () => {
      dismissNodexTooltips();
    });

    expect(tooltipIsMounted()).toBe(false);
  });

  test("does not remount the trigger when disabled changes", async () => {
    const renderTooltip = (disabled: boolean) => (
      <NodexTooltipProvider>
        <NodexTooltip tooltipContent="Shared tooltip body" defaultOpen disabled={disabled}>
          <button type="button">Stable trigger</button>
        </NodexTooltip>
      </NodexTooltipProvider>
    );
    const view = render(renderTooltip(false));
    const triggerBefore = view.getByRole("button", { name: "Stable trigger" });

    expect(tooltipIsMounted()).toBe(true);

    await act(async () => {
      view.rerender(renderTooltip(true));
    });

    expect(tooltipIsMounted()).toBe(false);
    const triggerAfter = view.getByRole("button", { name: "Stable trigger" });
    expect(triggerAfter).toBe(triggerBefore);
    expect(triggerAfter.getAttribute("aria-describedby")).toBeNull();
  });

  test("does not remount the trigger when tooltip content becomes unavailable", async () => {
    const renderTooltip = (tooltipContent: string | null) => (
      <NodexTooltipProvider>
        <NodexTooltip tooltipContent={tooltipContent} defaultOpen>
          <button type="button">Stable content trigger</button>
        </NodexTooltip>
      </NodexTooltipProvider>
    );
    const view = render(renderTooltip("Shared tooltip body"));
    const triggerBefore = view.getByRole("button", { name: "Stable content trigger" });

    await act(async () => {
      view.rerender(renderTooltip(null));
    });

    expect(tooltipIsMounted()).toBe(false);
    const triggerAfter = view.getByRole("button", { name: "Stable content trigger" });
    expect(triggerAfter).toBe(triggerBefore);
    expect(triggerAfter.getAttribute("aria-describedby")).toBeNull();
  });

  test("renders shortcut labels as keyboard input", async () => {
    const view = render(
      <NodexTooltipProvider>
        <NodexTooltip tooltipContent="Click to dictate or hold" shortcutLabel="Ctrl+M" defaultOpen>
          <button type="button">Dictate</button>
        </NodexTooltip>
      </NodexTooltipProvider>,
    );

    expect(view.getAllByText("Ctrl+M").every((element) => element.tagName === "KBD")).toBe(true);
  });

  test("dismisses an open uncontrolled tooltip through the shared dismiss event", async () => {
    await renderOpenTooltip();

    expect(tooltipIsMounted()).toBe(true);

    await act(async () => {
      dismissNodexTooltips();
    });

    expect(tooltipIsMounted()).toBe(false);
  });

  test("dismisses an open tooltip without remounting the trigger", async () => {
    const view = await renderOpenTooltip();
    const triggerBefore = view.getByRole("button", { name: "Hover me" });

    expect(tooltipIsMounted()).toBe(true);

    await act(async () => {
      dismissNodexTooltips();
    });

    expect(tooltipIsMounted()).toBe(false);
    expect(view.getByRole("button", { name: "Hover me" })).toBe(triggerBefore);
  });

  test("preserves tooltip-wrapped clicks after a capture-phase pointerdown dismissal", async () => {
    let clickCount = 0;

    function CaptureDismissHarness() {
      useEffect(() => {
        const dismissOnPointerDown = () => {
          dismissNodexTooltips();
        };

        document.addEventListener("pointerdown", dismissOnPointerDown, true);
        return () => {
          document.removeEventListener("pointerdown", dismissOnPointerDown, true);
        };
      }, []);

      return (
        <NodexTooltipProvider>
          <NodexTooltip tooltipContent="Shared tooltip body" defaultOpen>
            <button
              type="button"
              onClick={() => {
                clickCount += 1;
              }}
            >
              Click through
            </button>
          </NodexTooltip>
        </NodexTooltipProvider>
      );
    }

    const view = render(<CaptureDismissHarness />);
    const trigger = view.getByRole("button", { name: "Click through" });

    await act(async () => {
      fireEvent.pointerDown(trigger);
      fireEvent.click(trigger);
    });

    expect(clickCount).toBe(1);
    expect(view.getByRole("button", { name: "Click through" })).toBe(trigger);
  });

  test("dismisses open tooltips when the window blurs", async () => {
    await renderOpenTooltip();

    expect(tooltipIsMounted()).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(tooltipIsMounted()).toBe(false);
  });

  test("dismisses open tooltips when the document becomes hidden", async () => {
    await renderOpenTooltip();

    expect(tooltipIsMounted()).toBe(true);

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

    expect(tooltipIsMounted()).toBe(false);
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

    expect(tooltipIsMounted()).toBe(true);

    await act(async () => {
      dismissNodexTooltips();
    });

    expect(openChanges.length).toBe(1);
    expect(openChanges[0]).toBe(false);
    expect(tooltipIsMounted()).toBe(false);
  });
});
