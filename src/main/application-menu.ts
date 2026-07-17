import type { MenuItemConstructorOptions } from "electron";
import {
  getPrimaryCommandAccelerator,
  toElectronAccelerator,
  type CommandKeymapState,
} from "../shared/command-keybindings";
import {
  TOGGLE_BOTTOM_PANEL_COMMAND_ID,
  type WorkbenchCommandInvocation,
} from "../shared/workbench-commands";

export const TOGGLE_BOTTOM_PANEL_MENU_ITEM_ID = "view.toggleBottomPanel";

export function buildWorkbenchViewMenu(
  commandKeymapState: CommandKeymapState,
  onExecuteCommand: (invocation: WorkbenchCommandInvocation) => void,
): MenuItemConstructorOptions {
  return {
    label: "View",
    submenu: [
      {
        id: TOGGLE_BOTTOM_PANEL_MENU_ITEM_ID,
        label: "Toggle Bottom Panel",
        accelerator: toElectronAccelerator(
          getPrimaryCommandAccelerator(commandKeymapState, TOGGLE_BOTTOM_PANEL_COMMAND_ID),
        ),
        click: () => {
          onExecuteCommand({
            commandId: TOGGLE_BOTTOM_PANEL_COMMAND_ID,
            source: "menu",
          });
        },
      },
      { type: "separator" },
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };
}
