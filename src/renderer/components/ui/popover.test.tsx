import { describe, expect, test } from "bun:test";
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
  test("renders the shared Nodex popover surface", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(
        <NodexPopover>
          <NodexPopoverTrigger asChild>
            <button type="button">Open popover</button>
          </NodexPopoverTrigger>
          <NodexPopoverContent>
            <NodexPopoverTitle>Popover title</NodexPopoverTitle>
            <div>Popover body</div>
          </NodexPopoverContent>
        </NodexPopover>,
      );
    });

    const trigger = view.getByText("Open popover");

    await act(async () => {
      fireEvent.click(trigger);
      await settleAsyncRender();
    });

    const content = view.container.ownerDocument.body.querySelector('[data-slot="popover-content"]');
    expect(content).not.toBeNull();
    expect(view.getByText("Popover title").textContent).toBe("Popover title");
    expect(view.getByText("Popover body").textContent).toBe("Popover body");
  });
});
