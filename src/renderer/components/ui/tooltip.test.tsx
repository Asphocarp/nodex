import { describe, expect, test } from "bun:test";
import { act } from "react";
import { render } from "@/test/dom";
import {
  NodexTooltip,
  NodexTooltipProvider,
  dismissNodexTooltips,
} from "./tooltip";

describe("codex tooltip", () => {
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
    expect(view.container.ownerDocument.body.querySelector('[role="tooltip"]') === null).toBeTrue();

    await act(async () => {
      dismissNodexTooltips();
    });

    const dismissedTooltip = view.container.ownerDocument.body.querySelector('[role="tooltip"]');
    expect(dismissedTooltip === null).toBeTrue();
  });
});
