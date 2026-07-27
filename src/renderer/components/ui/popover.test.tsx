import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import {
  NodexPopover,
  NodexPopoverContent,
  NodexPopoverTitle,
  NodexPopoverTrigger,
} from "./popover";

describe("nodex popover", () => {
  test("portals content by default", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(
        <div data-testid="owner">
          <NodexPopover>
            <NodexPopoverTrigger asChild>
              <button type="button">Open popover</button>
            </NodexPopoverTrigger>
            <NodexPopoverContent>
              <NodexPopoverTitle>Popover title</NodexPopoverTitle>
              <div>Popover body</div>
            </NodexPopoverContent>
          </NodexPopover>
        </div>,
      );
    });

    const trigger = view.getByText("Open popover");

    await act(async () => {
      fireEvent.click(trigger);
      await settleAsyncRender();
    });

    const content = view.container.ownerDocument.body.querySelector('[data-slot="popover-content"]');
    expect(content).not.toBeNull();
    expect(view.getByTestId("owner").querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(view.getByText("Popover title").textContent).toBe("Popover title");
    expect(view.getByText("Popover body").textContent).toBe("Popover body");
  });

  test("can keep content inline with its structural owner", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(
        <div data-testid="owner">
          <NodexPopover open>
            <NodexPopoverTrigger asChild>
              <button type="button">Open inline popover</button>
            </NodexPopoverTrigger>
            <NodexPopoverContent portalled={false}>
              <div>Inline popover body</div>
            </NodexPopoverContent>
          </NodexPopover>
        </div>,
      );
      await settleAsyncRender();
    });

    const owner = view.getByTestId("owner");
    expect(owner.querySelector('[data-slot="popover-content"]')).not.toBeNull();
    expect(view.getByText("Inline popover body").textContent).toBe("Inline popover body");
  });
});
