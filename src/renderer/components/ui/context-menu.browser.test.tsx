import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import "../../globals.css";

import {
  NodexContextMenuContent,
  NodexContextMenuItem,
  NodexContextMenuPortal,
  NodexContextMenuRoot,
  NodexContextMenuSubmenu,
  NodexContextMenuSubmenuTrigger,
  NodexContextMenuTrigger,
} from "./context-menu";

const settleFloatingSurface = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

function ContextMenuProbe() {
  const submenu = (label: string) => (
    <NodexContextMenuSubmenu
      trigger={<NodexContextMenuSubmenuTrigger>{label}</NodexContextMenuSubmenuTrigger>}
      renderContent={() => <NodexContextMenuItem>{label} action</NodexContextMenuItem>}
    />
  );

  return (
    <NodexContextMenuRoot>
      <NodexContextMenuTrigger asChild>
        <button type="button">Page row</button>
      </NodexContextMenuTrigger>
      <NodexContextMenuPortal>
        <NodexContextMenuContent>
          {submenu("First")}
          {submenu("Second")}
        </NodexContextMenuContent>
      </NodexContextMenuPortal>
    </NodexContextMenuRoot>
  );
}

describe("context menu interaction in Chromium", () => {
  test("shows the root without entry motion and switches sibling submenus in the same frame", async () => {
    const view = render(<ContextMenuProbe />);

    await act(async () => {
      fireEvent.contextMenu(view.getByRole("button", { name: "Page row" }), {
        clientX: 80,
        clientY: 80,
      });
      await settleFloatingSurface();
    });

    const root = document.querySelector<HTMLElement>("[data-slot='context-menu-content']");
    if (!root) throw new Error("Expected the root context menu surface.");
    expect(getComputedStyle(root).animationName).toBe("none");

    await act(async () => {
      fireEvent.pointerMove(view.getByText("First"), {
        pointerType: "mouse",
        movementY: 2,
      });
      await Promise.resolve();
    });
    expect(view.getByText("First action")).toBeTruthy();

    const startedAt = performance.now();
    await act(async () => {
      fireEvent.pointerLeave(view.getByText("First"), { pointerType: "mouse" });
      fireEvent.pointerMove(view.getByText("Second"), {
        pointerType: "mouse",
        movementY: 2,
      });
      await Promise.resolve();
    });
    const elapsed = performance.now() - startedAt;

    expect(view.queryByText("First action")).toBeNull();
    expect(view.getByText("Second action")).toBeTruthy();
    expect(elapsed).toBeLessThan(80);

    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
    });
    expect(view.queryByText("First action")).toBeNull();
    expect(view.getByText("Second action")).toBeTruthy();

    await act(settleFloatingSurface);
    const content = view.getByText("Second action").closest<HTMLElement>(
      "[data-slot='context-menu-subcontent']",
    );
    if (!content) throw new Error("Expected the open submenu surface.");
    const contentRect = content.getBoundingClientRect();
    expect(Math.abs(contentRect.left - root.getBoundingClientRect().right)).toBeLessThanOrEqual(4);
  });
});
