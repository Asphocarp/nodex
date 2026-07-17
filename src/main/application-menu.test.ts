import { describe, expect, test } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import type { WorkbenchCommandInvocation } from "../shared/workbench-commands";
import { createCommandKeymapState } from "../shared/command-keybindings";
import {
  buildWorkbenchViewMenu,
  TOGGLE_BOTTOM_PANEL_MENU_ITEM_ID,
} from "./application-menu";

function bottomPanelMenuItem(
  platform: "macOS" | "windows" | "linux",
  overrides: Record<string, string[]> = {},
  onExecuteCommand: (invocation: WorkbenchCommandInvocation) => void = () => undefined,
): MenuItemConstructorOptions {
  const menu = buildWorkbenchViewMenu(
    createCommandKeymapState(overrides, platform),
    onExecuteCommand,
  );
  const submenu = menu.submenu as MenuItemConstructorOptions[];
  const item = submenu.find((candidate) => candidate.id === TOGGLE_BOTTOM_PANEL_MENU_ITEM_ID);
  if (!item) throw new Error("Expected the Toggle Bottom Panel menu item");
  return item;
}

describe("application menu", () => {
  test.each(["macOS", "windows", "linux"] as const)(
    "builds the bottom-panel accelerator on %s",
    (platform) => {
      expect(bottomPanelMenuItem(platform).accelerator).toBe("CommandOrControl+J");
    },
  );

  test("uses the custom primary accelerator and preserves explicit unassignment", () => {
    expect(bottomPanelMenuItem("macOS", {
      toggleBottomPanel: ["CmdOrCtrl+Alt+J"],
    }).accelerator).toBe("CommandOrControl+Alt+J");
    expect(bottomPanelMenuItem("macOS", {
      toggleBottomPanel: [],
    }).accelerator).toBeUndefined();
  });

  test("dispatches the typed workbench command once", () => {
    const invocations: unknown[] = [];
    const item = bottomPanelMenuItem("macOS", {}, (invocation) => {
      invocations.push(invocation);
    });

    if (typeof item.click !== "function") throw new Error("Expected a menu click handler");
    item.click({} as never, {} as never, {} as never);

    expect(invocations).toEqual([{
      commandId: "toggleBottomPanel",
      source: "menu",
    }]);
  });
});
