import type {
  NativeContextMenuItem,
  NativeContextMenuOptions,
} from "../../shared/native-context-menu";

export async function showNativeContextMenu(
  items: NativeContextMenuItem[],
  options?: NativeContextMenuOptions,
): Promise<string | null> {
  if (typeof window === "undefined" || !window.electronBridge?.showContextMenu) {
    throw new Error("Native context menus require Electron");
  }

  return await window.electronBridge.showContextMenu(items, options);
}
