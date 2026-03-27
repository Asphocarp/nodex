import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { BranchSelectorPopover } from "./branch-selector-popover";

describe("branch selector popover", () => {
  test("renders as a dropdown menu instead of a selector popover shell", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(
        <NodexTooltipProvider>
          <BranchSelectorPopover
            cwd="/Users/asc/repo/nodex"
            busy={false}
            state={{
              currentBranch: "main",
              defaultBranch: "main",
              branches: ["main", "feature/dropdown"],
            }}
            onRefresh={async () => { }}
            onCheckout={async () => true}
            onCreate={async () => true}
          />
        </NodexTooltipProvider>,
      );
    });

    await act(async () => {
      const trigger = view.getByLabelText("Select Git branch");
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await settleAsyncRender();
    });

    const content = view.container.ownerDocument.body.querySelector('[data-radix-menu-content]');
    const popover = view.container.ownerDocument.body.querySelector('[data-slot="popover-content"]');
    const searchInput = view.container.ownerDocument.body.querySelector('input[placeholder="Search branches"]');

    expect(content).not.toBeNull();
    expect(popover === null).toBeTrue();
    expect(searchInput).not.toBeNull();
    expect(view.container.ownerDocument.body.textContent?.includes("Create and checkout new branch…") ?? false).toBeTrue();
  });
});
