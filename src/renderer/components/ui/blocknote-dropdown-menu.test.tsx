import { describe, expect, test } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../../third_party/blocknote/packages/shadcn/src/components/ui/dropdown-menu";
import { render, settleAsyncRender } from "@/test/dom";

describe("BlockNote shadcn dropdown menu", () => {
  test("portals top-level content outside the dropdown host clipping container", async () => {
    const view = render(
      <div data-testid="menu-host">
        <DropdownMenu open>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent data-testid="parent-menu">
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>,
    );

    await settleAsyncRender();

    const host = view.getByTestId("menu-host");
    const parentMenu = view.getByTestId("parent-menu");

    expect(host.contains(parentMenu)).toBe(false);
    expect(document.body.contains(parentMenu)).toBe(true);
  });

  test("portals submenu content outside the parent dropdown clipping container", async () => {
    const view = render(
      <div data-testid="menu-host">
        <DropdownMenu open>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent data-testid="parent-menu" className="overflow-x-hidden">
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger>Colors</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-testid="color-submenu">
                <DropdownMenuItem>Blue</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>,
    );

    await settleAsyncRender();

    const host = view.getByTestId("menu-host");
    const parentMenu = view.getByTestId("parent-menu");
    const submenu = view.getByTestId("color-submenu");

    expect(parentMenu.contains(submenu)).toBe(false);
    expect(host.contains(submenu)).toBe(false);
    expect(document.body.contains(submenu)).toBe(true);
  });
});
